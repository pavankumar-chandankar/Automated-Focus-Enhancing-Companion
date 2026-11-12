import React, { useState, useEffect } from 'react';

function FocusSession({ focusTime, breakTime, onEnd }) {
  const [timeRemaining, setTimeRemaining] = useState(focusTime * 60);
  const [isBreak, setIsBreak] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemaining(prev => prev - 1);
    }, 1000);

    if (timeRemaining === 0) {
      clearInterval(timer);
      if (isBreak) {
        onEnd();
      } else {
        setTimeRemaining(breakTime * 60);
        setIsBreak(true);
      }
    }

    return () => clearInterval(timer);
  }, [timeRemaining, isBreak]);

  return (
    <div>
      <h2>{isBreak ? 'Break Time' : 'Focus Time'}</h2>
      <p>Time Remaining: {Math.floor(timeRemaining / 60)}:{timeRemaining % 60}</p>
    </div>
  );
}

export default FocusSession;
