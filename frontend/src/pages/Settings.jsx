import React, { useState, useEffect } from 'react';
import * as api from '../api';

export default function Settings() {
  const [config, setConfig] = useState({
    DEFAULT_LLM: 'ollama',
    MODEL_NAME: 'deepseek-r1:7b',
    OPENAI_API_KEY: '',
    DEEPSEEK_API_KEY: ''
  });

  const saveSettings = async () => {
    try {
      await api.updateConfig(config);
      alert('Settings saved successfully!');
    } catch (e) {
      alert('Failed to save settings.');
    }
  };

  return (
    <div className="col panel" style={{ padding: 20, maxWidth: 600 }}>
      <div className="ph">■ SYSTEM CONFIGURATION</div>
      <div className="col" style={{ gap: 15, marginTop: 20 }}>
        <div className="col">
          <label className="ml">LLM PROVIDER</label>
          <select 
            value={config.DEFAULT_LLM} 
            onChange={e => setConfig({...config, DEFAULT_LLM: e.target.value})}
            className="input"
          >
            <option value="ollama">Ollama (Local)</option>
            <option value="openai">OpenAI</option>
            <option value="deepseek">DeepSeek</option>
          </select>
        </div>
        <div className="col">
          <label className="ml">MODEL NAME</label>
          <input 
            className="input" 
            value={config.MODEL_NAME}
            onChange={e => setConfig({...config, MODEL_NAME: e.target.value})}
          />
        </div>
        <div className="col">
          <label className="ml">API KEY (If required)</label>
          <input 
            type="password"
            className="input" 
            value={config.OPENAI_API_KEY}
            onChange={e => setConfig({...config, OPENAI_API_KEY: e.target.value})}
          />
        </div>
        <button className="btn" onClick={saveSettings}>Save Configuration</button>
      </div>
    </div>
  );
}
