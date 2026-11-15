import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { Icon } from '../lib/icons.jsx';

export function AuthModal() {
  const { authModalOpen, setAuthModalOpen, login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [callsign, setCallsign] = useState('ARES-CREW-1');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!authModalOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        if (!email.trim()) throw new Error('Email is required');
        await register(username.trim(), email.trim(), password, callsign.trim());
      } else {
        await login(username.trim(), password);
      }
    } catch (err) {
      setError(err?.detail || err?.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-void/80 backdrop-blur-sm"
      onClick={() => setAuthModalOpen(false)}
    >
      <div
        className="card w-full max-w-md p-6 relative flex flex-col gap-4 border border-line2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-4 right-4 icon-btn !w-7 !h-7 text-dust hover:text-bone"
          onClick={() => setAuthModalOpen(false)}
          aria-label="Close authentication modal"
        >
          <Icon n="x" s={16} />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-ember/20 text-ember flex items-center justify-center">
            <Icon n="user" s={18} />
          </div>
          <div>
            <h2 className="font-semibold text-base">
              {isRegister ? 'Register EVA Astronaut' : 'Astronaut Sign In'}
            </h2>
            <p className="text-xs text-dust">
              Persisted in Neon PostgreSQL database
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-hazard/15 border border-hazard/30 text-xs text-hazard">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 mt-1">
          <div>
            <label className="block text-xs text-dust font-medium mb-1">Username</label>
            <input
              type="text"
              required
              minLength={3}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. elena_vance"
              className="w-full h-9 px-3 rounded-lg bg-basalt border border-line focus:border-dusk text-sm text-bone outline-none"
            />
          </div>

          {isRegister && (
            <>
              <div>
                <label className="block text-xs text-dust font-medium mb-1">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="astronaut@ares.nasa.gov"
                  className="w-full h-9 px-3 rounded-lg bg-basalt border border-line focus:border-dusk text-sm text-bone outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-dust font-medium mb-1">Crew Callsign</label>
                <input
                  type="text"
                  value={callsign}
                  onChange={(e) => setCallsign(e.target.value)}
                  placeholder="e.g. ARES-EVA-LEAD"
                  className="w-full h-9 px-3 rounded-lg bg-basalt border border-line focus:border-dusk text-sm text-bone outline-none"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs text-dust font-medium mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-9 px-3 rounded-lg bg-basalt border border-line focus:border-dusk text-sm text-bone outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-pri w-full mt-2 !min-h-10 text-sm font-semibold"
          >
            {loading ? 'Transmitting...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <div className="flex items-center justify-between text-xs text-dust pt-2 border-t border-line">
          <span>
            {isRegister ? 'Already registered?' : 'New expedition crew member?'}
          </span>
          <button
            type="button"
            className="text-dusk hover:underline font-semibold"
            onClick={() => {
              setIsRegister(!isRegister);
              setError('');
            }}
          >
            {isRegister ? 'Sign in instead' : 'Create an account'}
          </button>
        </div>
      </div>
    </div>
  );
}
