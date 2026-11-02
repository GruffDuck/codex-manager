export type SignInDestination = 'browser' | 'app';

declare global {
  interface Window {
    codexManager?: {
      openSignIn: (url: string, mode: SignInDestination) => Promise<void>;
      closeSignIn: () => Promise<void>;
    };
  }
}

export async function openSignIn(url: string, mode: SignInDestination): Promise<void> {
  if (window.codexManager) return window.codexManager.openSignIn(url, mode);
  // Keep Manager open; the waiting view also offers a normal link if popups are blocked.
  window.open(url, '_blank', 'noopener,noreferrer');
}
