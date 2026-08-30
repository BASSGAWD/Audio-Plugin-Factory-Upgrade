import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {ClerkProvider} from '@clerk/react';
import App from './App.tsx';
import './index.css';

const publishableKey = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required for authenticated project sync.");

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </StrictMode>,
);
