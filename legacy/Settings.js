import React from 'react';

function Settings({ focusTime, setFocusTime, breakTime, setBreakTime }) {
  return (
    <div>
      <label>Focus Time (minutes): </label>
      <input type="number" value={focusTime} onChange={(e) => setFocusTime(e.target.value)} />
      <br />
      <label>Break Time (minutes): </label>
      <input type="number" value={breakTime} onChange={(e) => setBreakTime(e.target.value)} />
    </div>
  );
}

export default Settings;
