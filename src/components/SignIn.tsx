import { useEffect, useRef, useState } from 'react';
import { loadGoogleIdentity } from '../auth';

interface Props {
  googleClientId: string;
  message?: string;
  onCredential: (credential: string) => void;
}

export default function SignIn({ googleClientId, message, onCredential }: Props) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentity()
      .then((gsi) => {
        if (cancelled || !buttonRef.current) return;
        gsi.initialize({
          client_id: googleClientId,
          callback: ({ credential }) => onCredentialRef.current(credential),
          auto_select: true,
        });
        gsi.renderButton(buttonRef.current, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
        gsi.prompt();
      })
      .catch((err: Error) => setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [googleClientId]);

  return (
    <div className="sign-in">
      <div className="sign-in-card card">
        <h1>jobgrindr</h1>
        <p className="subtitle">Track your job applications from applied to offer.</p>
        <div ref={buttonRef} className="google-button" />
        {(message || loadError) && <p className="sign-in-message">{loadError ?? message}</p>}
      </div>
    </div>
  );
}
