import React from 'react';
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

export default function AdvancedChart({ data, prediction }) {
  // data: [{t, p, rsi, bb_upper, bb_lower, ema_20, ema_50}, ...]
  // prediction: [p1, p2, p3, p4, p5]
  
  const formattedPrediction = prediction ? prediction.map((p, i) => ({ t: `Pred ${i+1}`, prediction: p })) : [];
  const combinedData = [...data.map(d => ({...d, price: d.p})), ...formattedPrediction];

  return (
    <div style={{ height: 400, width: '100%' }}>
      <ResponsiveContainer>
        <ComposedChart data={combinedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="t" stroke="#6b7280" />
          <YAxis yAxisId="left" domain={['auto', 'auto']} stroke="#6b7280" />
          <Tooltip contentStyle={{ background: '#040810', border: '1px solid #1f2937' }} />
          <Legend />
          
          {/* Bollinger Bands */}
          <Area yAxisId="left" type="monotone" dataKey="bb_upper" stroke="none" fill="#1f2937" fillOpacity={0.3} />
          <Area yAxisId="left" type="monotone" dataKey="bb_lower" stroke="none" fill="#1f2937" fillOpacity={0.3} />
          
          {/* Main Price */}
          <Line yAxisId="left" type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={2} dot={false} />
          
          {/* EMAs */}
          <Line yAxisId="left" type="monotone" dataKey="ema_20" stroke="#f59e0b" strokeWidth={1} dot={false} />
          <Line yAxisId="left" type="monotone" dataKey="ema_50" stroke="#8b5cf6" strokeWidth={1} dot={false} />
          
          {/* Kronos Prediction */}
          <Line yAxisId="left" type="monotone" dataKey="prediction" stroke="#ec4899" strokeWidth={3} strokeDasharray="5 5" dot={true} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
