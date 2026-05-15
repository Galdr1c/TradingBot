import React, { createContext, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const ToastContext = createContext({ notify: () => {} });

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const notify = (message, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setItems(prev => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => setItems(prev => prev.filter(x => x.id !== id)), 4500);
  };
  const value = useMemo(() => ({ notify }), []);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map(item => <ToastItem key={item.id} item={item} onClose={() => setItems(prev => prev.filter(x => x.id !== item.id))} />)}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ item, onClose }) {
  const Icon = item.type === 'success' ? CheckCircle2 : item.type === 'error' ? AlertTriangle : Info;
  return (
    <div className={`toast ${item.type}`}>
      <Icon size={16} />
      <span>{item.message}</span>
      <button type="button" onClick={onClose} aria-label="Bildirimi kapat"><X size={14} /></button>
    </div>
  );
}

export const useToast = () => useContext(ToastContext);

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="panel state-card error-state">
          <AlertTriangle size={26} />
          <h3>Bu ekran güvenli moda alındı</h3>
          <p>{this.state.error?.message || 'Beklenmeyen arayüz hatası.'}</p>
          <button className="btn" type="button" onClick={() => this.setState({ error: null })}>Tekrar dene</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function EmptyState({ title = 'Veri yok', text = 'Bu alan için gösterilecek veri henüz hazır değil.', action }) {
  return (
    <div className="state-card empty-state">
      <Info size={24} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function ErrorState({ title = 'İşlem tamamlanamadı', error, onRetry }) {
  return (
    <div className="state-card error-state">
      <AlertTriangle size={24} />
      <h3>{title}</h3>
      <p>{error?.message || String(error || 'Bilinmeyen hata')}</p>
      {onRetry && <button className="btn sm" type="button" onClick={onRetry}>Tekrar dene</button>}
    </div>
  );
}

export function LoadingState({ text = 'Yükleniyor...' }) {
  return <div className="loading-card"><span className="loader-dot" /> {text}</div>;
}
