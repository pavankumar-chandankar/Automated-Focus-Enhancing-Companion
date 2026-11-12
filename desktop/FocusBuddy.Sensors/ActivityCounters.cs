// Cross-platform, consent-driven example of events-to-aggregate bookkeeping.
// This library does NOT install Windows hooks, intercept keystrokes or read app titles.
using System;
namespace FocusBuddy.Sensors {
    public sealed class ActivityCounters {
        private readonly object _gate = new object();
        private int _switchCount;
        private TimeSpan _focused = TimeSpan.Zero;
        private TimeSpan _idle = TimeSpan.Zero;
        public void RegisterContextSwitch() { lock(_gate) _switchCount++; }
        public void RegisterFocusedInterval(TimeSpan span) {
            if (span < TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(span));
            lock (_gate) _focused += span;
        }
        public void RegisterIdleInterval(TimeSpan span) {
            if (span < TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(span));
            lock (_gate) _idle += span;
        }
        public object ExportAggregate(TimeSpan total) {
            if (total < TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(total));
            lock (_gate) {
                if (_focused + _idle > total) throw new InvalidOperationException("Inconsistent durations");
                return new { elapsed_minutes=total.TotalMinutes,
                    focused_minutes=_focused.TotalMinutes, idle_minutes=_idle.TotalMinutes,
                    context_switch_count=_switchCount, self_report_energy=(int?)null };
            }
        }
    }
}
