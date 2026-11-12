using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace FocusEnhancer
{
    class ActivityTracker
    {
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private static LowLevelKeyboardProc _proc = HookCallback;
        private static IntPtr _hookID = IntPtr.Zero;

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

        [DllImport("user32.dll")]
        private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

        [DllImport("user32.dll")]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll")]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        private struct LASTINPUTINFO
        {
            public uint cbSize;
            public uint dwTime;
        }

        private static string GetActiveWindowTitle()
        {
            const int nChars = 256;
            IntPtr handle = GetForegroundWindow();
            System.Text.StringBuilder Buff = new System.Text.StringBuilder(nChars);
            if (GetWindowText(handle, Buff, nChars) > 0)
            {
                return Buff.ToString();
            }
            return null;
        }

        private static uint GetIdleTime()
        {
            LASTINPUTINFO lastInPut = new LASTINPUTINFO();
            lastInPut.cbSize = (uint)Marshal.SizeOf(lastInPut);
            GetLastInputInfo(ref lastInPut);
            return ((uint)Environment.TickCount - lastInPut.dwTime) / 1000;
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && wParam == (IntPtr)WM_KEYDOWN)
            {
                int vkCode = Marshal.ReadInt32(lParam);
                Console.WriteLine((Keys)vkCode);
            }
            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }

        public static void StartTracking()
        {
            _hookID = SetHook(_proc);
            string lastWindowTitle = null;

            while (true)
            {
                Thread.Sleep(1000);  // Check every second
                string currentWindowTitle = GetActiveWindowTitle();
                uint idleTime = GetIdleTime();

                if (currentWindowTitle != lastWindowTitle)
                {
                    lastWindowTitle = currentWindowTitle;
                    Console.WriteLine($"Active Window: {currentWindowTitle}");
                }

                Console.WriteLine($"Idle Time: {idleTime} seconds");

                // You can add more logic here to track and analyze the activity

                // Example of taking action when idle time exceeds a threshold
                if (idleTime > 300)  // 5 minutes
                {
                    Console.WriteLine("User has been idle for more than 5 minutes. Suggesting a break.");
                }
            }
        }

        private static IntPtr SetHook(LowLevelKeyboardProc proc)
        {
            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule)
            {
                return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
            }
        }

        public static void StopTracking()
        {
            UnhookWindowsHookEx(_hookID);
        }

        static void Main(string[] args)
        {
            StartTracking();
            Application.Run();  // Keep the application running to track activities
            StopTracking();
        }
    }
}
