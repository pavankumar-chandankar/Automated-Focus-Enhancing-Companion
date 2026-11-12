import time
import os
import ctypes
import psutil
from pynput import keyboard, mouse

user32 = ctypes.windll.user32
GetForegroundWindow = user32.GetForegroundWindow
GetWindowTextLength = user32.GetWindowTextLengthW
GetWindowText = user32.GetWindowTextW

class ActivityTracker:
    def __init__(self):
        self.active_window_name = None
        self.idle_start_time = None
        self.idle_time_threshold = 60  # 1 minute threshold
        self.activity_log = []

    def get_active_window(self):
        hwnd = GetForegroundWindow()
        length = GetWindowTextLength(hwnd)
        window_title = GetWindowText(hwnd, length)
        return window_title

    def log_activity(self, activity_type, details):
        timestamp = time.time()
        self.activity_log.append({
            'timestamp': timestamp,
            'type': activity_type,
            'details': details
        })

    def detect_idle_time(self):
        if self.idle_start_time is None:
            self.idle_start_time = time.time()
        elif time.time() - self.idle_start_time > self.idle_time_threshold:
            self.log_activity('idle', 'User has been idle')

    def on_keyboard_activity(self, key):
        self.idle_start_time = None
        self.log_activity('keyboard', f'Key pressed: {key}')

    def on_mouse_activity(self, x, y):
        self.idle_start_time = None
        self.log_activity('mouse', f'Mouse moved to: {(x, y)}')

    def run(self):
        with keyboard.Listener(on_press=self.on_keyboard_activity) as kb_listener, \
             mouse.Listener(on_move=self.on_mouse_activity) as ms_listener:
            while True:
                current_window = self.get_active_window()
                if current_window != self.active_window_name:
                    self.active_window_name = current_window
                    self.log_activity('window_change', f'Active window: {current_window}')
                self.detect_idle_time()
                time.sleep(1)
            kb_listener.join()
            ms_listener.join()

if __name__ == "__main__":
    tracker = ActivityTracker()
    tracker.run()
