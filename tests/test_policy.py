from focusbuddy.domain.intervention import decide
from focusbuddy.domain.schemas import AggregateSignal, Preferences


def sig(**change):
    return AggregateSignal(**{'elapsed_minutes':25,'focused_minutes':10,
                              'idle_minutes':5,'context_switch_count':10,**change})

def test_high_switches_offer():
    assert decide(sig(),Preferences(),0).offer

def test_no_intervention_when_snoozed():
    assert not decide(sig(),Preferences(),0,snoozed=True).offer

def test_quiet_mode():
    assert not decide(sig(),Preferences(intervention_style='quiet'),0).offer

def test_nudge_budget_hard_stop():
    assert not decide(sig(),Preferences(maximum_nudges_per_hour=1),1).offer

def test_insufficient_observation():
    assert not decide(sig(elapsed_minutes=3,focused_minutes=1,idle_minutes=1,context_switch_count=1),Preferences(),0).offer

def test_focus_interval_offer():
    assert decide(sig(elapsed_minutes=30,focused_minutes=27,idle_minutes=1,context_switch_count=1),Preferences(),0).offer

def test_no_offer_for_short_steady_work():
    assert not decide(sig(elapsed_minutes=12,focused_minutes=10,idle_minutes=0,context_switch_count=1),Preferences(),0).offer
