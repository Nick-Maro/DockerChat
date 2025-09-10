import { useState, useEffect } from 'preact/hooks';

interface UsernameModalProps {
  isOpen: boolean;
  onSubmit: (username: string) => void;
  onCancel: () => void;
  title?: string;
}

const UsernameModal = ({ 
  isOpen, 
  onSubmit, 
  onCancel, 
  title = "Enter Username" 
}: UsernameModalProps) => {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const validateUsername = (username: string): boolean => {
    const regex = /^[a-zA-Z0-9_-]{3,16}$/;
    return regex.test(username);
  };

  const handleSubmit = () => {
    const trimmed = username.trim();
    
    if (!trimmed) {
      setError("Username cannot be empty!");
      return;
    }
    
    if (!validateUsername(trimmed)) {
      setError("Username must be 3-16 characters long and contain only letters, numbers, underscores, and hyphens.");
      return;
    }
    
    setError('');
    setIsAnimating(true);
    setTimeout(() => {
      onSubmit(trimmed);
      setUsername('');
      setIsAnimating(false);
    }, 300);
  };

  const handleCancel = () => {
    setIsVisible(false);
    setTimeout(() => {
      setUsername('');
      setError('');
      onCancel();
    }, 200);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
    if (e.key === 'Escape') {
      handleCancel();
    }
  };

 
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  
  useEffect(() => {
    if (error && username) {
      setError('');
    }
  }, [username]);

  if (!isOpen) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        backdropFilter: 'blur(8px)',
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.3s ease-out'
      }}
    >
      <style>{`
        @keyframes modalSlideIn {
          from { 
            opacity: 0; 
            transform: translateY(-20px) scale(0.95);
          }
          to { 
            opacity: 1; 
            transform: translateY(0) scale(1);
          }
        }
        
        @keyframes modalSlideOut {
          from { 
            opacity: 1; 
            transform: translateY(0) scale(1);
          }
          to { 
            opacity: 0; 
            transform: translateY(-20px) scale(0.95);
          }
        }
        
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
        
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-4px); }
          40%, 80% { transform: translateX(4px); }
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        @keyframes glow {
          0%, 100% { 
            box-shadow: 0 0 20px rgba(135, 117, 233, 0.3), 
                       0 8px 32px rgba(135, 117, 233, 0.2); 
          }
          50% { 
            box-shadow: 0 0 30px rgba(135, 117, 233, 0.5), 
                       0 8px 40px rgba(135, 117, 233, 0.3); 
          }
        }
        
        .modal-content {
          animation: ${isVisible ? 'modalSlideIn' : 'modalSlideOut'} 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        
        .submit-btn {
          position: relative;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .submit-btn:before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
          transition: left 0.5s;
        }
        
        .submit-btn:hover:before {
          left: 100%;
        }
        
        .submit-btn:hover {
          background: linear-gradient(135deg, #9f8df0, #8775E9);
          transform: translateY(-2px);
          box-shadow: 0 12px 28px rgba(135, 117, 233, 0.4);
        }
        
        .submit-btn:active {
          transform: translateY(-1px);
        }
        
        .cancel-btn {
          transition: all 0.3s ease;
        }
        
        .cancel-btn:hover {
          background: #353535;
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
        }
        
        .input-field {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .input-field:focus {
          border-color: #8775E9;
          box-shadow: 0 0 0 3px rgba(135, 117, 233, 0.2);
          background: #2a2a2a;
        }
        
        .input-field::placeholder {
          color: #888888;
        }
        
        .error-shake {
          animation: shake 0.5s ease-in-out;
        }
        
        .processing {
          animation: pulse 1.5s infinite;
        }
        
        .loading-spinner {
          animation: spin 1s linear infinite;
        }
        
        .icon-container {
          background: linear-gradient(135deg, #8775E9, #9f8df0);
          animation: glow 2s ease-in-out infinite;
        }
        
        .gradient-text {
          background: linear-gradient(135deg, #8775E9, #b29ef5);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        
        .dark-glass {
          background: rgba(30, 30, 30, 0.95);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(135, 117, 233, 0.2);
        }
      `}</style>
      
      <div 
        className="modal-content dark-glass"
        style={{
          borderRadius: '20px',
          padding: '40px',
          width: '440px',
          maxWidth: '90vw',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(135, 117, 233, 0.1)',
          position: 'relative'
        }}
      >
        
        <div style={{
          textAlign: 'center',
          marginBottom: '32px'
        }}>
          <div 
            className="icon-container"
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              margin: '0 auto 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path 
                d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" 
                stroke="white" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              />
              <circle cx="12" cy="7" r="4" stroke="white" strokeWidth="2"/>
            </svg>
          </div>
          
          <h2 
            className="gradient-text"
            style={{
              margin: '0',
              fontSize: '28px',
              fontWeight: '700',
              letterSpacing: '-0.02em'
            }}
          >
            {title}
          </h2>
          
          <p style={{
            margin: '8px 0 0 0',
            fontSize: '16px',
            color: '#a0a0a0',
            fontWeight: '400'
          }}>
            Choose a unique username to continue
          </p>
        </div>
        
        
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block',
            marginBottom: '12px',
            fontSize: '15px',
            fontWeight: '600',
            color: '#e0e0e0'
          }}>
            Username
          </label>
          
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={username}
              onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter your username..."
              autoFocus
              className={`input-field ${error ? 'error-shake' : ''}`}
              style={{
                width: '100%',
                padding: '16px 20px',
                paddingLeft: '50px',
                border: error ? '2px solid #ef4444' : '2px solid #404040',
                borderRadius: '15px',
                fontSize: '16px',
                outline: 'none',
                boxSizing: 'border-box',
                background: '#252525',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontWeight: '500',
                color: '#ffffff'
              }}
            />
            
            <div style={{
              position: 'absolute',
              left: '16px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#8775E9',
              pointerEvents: 'none'
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path 
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" 
                  fill="currentColor"
                />
              </svg>
            </div>
          </div>
          
          <div style={{
            marginTop: '10px',
            fontSize: '13px',
            color: '#a0a0a0',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: '#8775E9'
            }}></div>
            3-16 characters • letters, numbers, underscores, hyphens
          </div>
        </div>
        
        
        {error && (
          <div 
            className="error-shake"
            style={{
              padding: '14px 18px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '12px',
              color: '#fca5a5',
              fontSize: '14px',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontWeight: '500'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path 
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              />
            </svg>
            {error}
          </div>
        )}
        
        
        <div style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '20px'
        }}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isAnimating}
            className={`submit-btn ${isAnimating ? 'processing' : ''}`}
            style={{
              flex: 1,
              padding: '16px 24px',
              background: 'linear-gradient(135deg, #8775E9, #9f8df0)',
              color: 'white',
              border: 'none',
              borderRadius: '15px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: isAnimating ? 'not-allowed' : 'pointer',
              boxShadow: '0 6px 20px rgba(135, 117, 233, 0.3)',
              opacity: isAnimating ? 0.8 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            {isAnimating && (
              <div 
                className="loading-spinner"
                style={{
                  width: '16px',
                  height: '16px',
                  border: '2px solid rgba(255, 255, 255, 0.3)',
                  borderTop: '2px solid white',
                  borderRadius: '50%'
                }}
              />
            )}
            {isAnimating ? 'Creating Account...' : 'Create Account'}
          </button>
          
          <button
            type="button"
            onClick={handleCancel}
            disabled={isAnimating}
            className="cancel-btn"
            style={{
              flex: 1,
              padding: '16px 24px',
              backgroundColor: '#2a2a2a',
              color: '#e0e0e0',
              border: '2px solid #404040',
              borderRadius: '15px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: isAnimating ? 'not-allowed' : 'pointer',
              opacity: isAnimating ? 0.5 : 1
            }}
          >
            Cancel
          </button>
        </div>
        
        
        <div style={{
          textAlign: 'center',
          fontSize: '13px',
          color: '#808080',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px'
        }}>
          <span>Press</span>
          <kbd style={{
            background: '#404040',
            color: '#e0e0e0',
            padding: '4px 8px',
            borderRadius: '6px',
            fontSize: '12px',
            fontFamily: 'ui-monospace, monospace',
            border: '1px solid #555555',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)'
          }}>Enter</kbd>
          <span>to submit or</span>
          <kbd style={{
            background: '#404040',
            color: '#e0e0e0',
            padding: '4px 8px',
            borderRadius: '6px',
            fontSize: '12px',
            fontFamily: 'ui-monospace, monospace',
            border: '1px solid #555555',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)'
          }}>Esc</kbd>
          <span>to cancel</span>
        </div>
      </div>
    </div>
  );
};

export default UsernameModal;