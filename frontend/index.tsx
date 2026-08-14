import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log('index.tsx: Starting React app');

document.addEventListener('DOMContentLoaded', () => {
  console.log('index.tsx: DOMContentLoaded event fired');
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('index.tsx: Could not find root element to mount to');
    throw new Error("Could not find root element to mount to");
  }

  console.log('index.tsx: Creating React root');
  const root = ReactDOM.createRoot(rootElement);
  console.log('index.tsx: Rendering app');
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  console.log('index.tsx: App rendered successfully');
});
