import React, { useState } from 'react';
import Settings from './Settings';
import FocusSession from './FocusSession';
import Report from './Report';

function App() {
  const [focusTime, setFocusTime] = useState(25);
  const [breakTime, setBreakTime] = useState(5);
  const [sessionActive, setSessionActive] = useState(false);

  const startSession = () => setSessionActive(true);
  const endSession = () => setSessionActive(false);

  return (
    <div className="App">
      <h1>Focus Enhancer</h1>
      {!sessionActive && (
        <Settings 
          focusTime={focusTime} 
          setFocusTime={setFocusTime} 
          breakTime={breakTime} 
          setBreakTime={setBreakTime} 
        />
      )}
      {sessionActive ? (
        <FocusSession focusTime={focusTime} breakTime={breakTime} onEnd={endSession} />
      ) : (
        <button onClick={startSession}>Start Focus Session</button>
      )}
      <Report />
    </div>
  );
}

export default App;
