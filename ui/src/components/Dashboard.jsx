export default function Dashboard({ agent, theme = 'dark' }) {
  const isDark = theme === 'dark';
  
  const metrics = [
    { label: 'Customer Satisfaction', value: '4.7/5', trend: '+0.3', icon: '⭐' },
    { label: 'First Call Resolution', value: '86%', trend: '+4%', icon: '✅' },
    { label: 'Avg Handle Time', value: '2:45', trend: '-0:12', icon: '⏱️' },
    { label: 'Service Level', value: '92%', trend: '+2%', icon: '🎯' },
  ];

  const styles = {
    container: {
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      borderRadius: '12px',
      padding: '20px',
    },
    title: {
      fontSize: '16px',
      fontWeight: '600',
      color: isDark ? '#f1f5f9' : '#1e293b',
      marginBottom: '20px',
    },
    metricsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '12px',
      marginBottom: '20px',
    },
    metricCard: {
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      padding: '16px',
      borderRadius: '10px',
      textAlign: 'center',
    },
    metricIcon: {
      fontSize: '24px',
      marginBottom: '8px',
    },
    metricValue: {
      fontSize: '22px',
      fontWeight: '600',
      color: isDark ? '#f1f5f9' : '#1e293b',
    },
    metricLabel: {
      fontSize: '11px',
      color: isDark ? '#94a3b8' : '#64748b',
      marginTop: '4px',
    },
    metricTrend: {
      fontSize: '10px',
      color: '#10b981',
      marginTop: '6px',
    },
    welcomeCard: {
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      padding: '20px',
      borderRadius: '10px',
      textAlign: 'center',
    },
    welcomeTitle: {
      fontSize: '16px',
      fontWeight: '600',
      color: isDark ? '#f1f5f9' : '#1e293b',
      marginBottom: '8px',
    },
    welcomeText: {
      fontSize: '12px',
      color: isDark ? '#94a3b8' : '#64748b',
      marginBottom: '16px',
    },
    tipBox: {
      backgroundColor: isDark ? '#1e293b' : '#f1f5f9',
      padding: '10px',
      borderRadius: '6px',
      fontSize: '11px',
      color: isDark ? '#cbd5e1' : '#475569',
    },
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Agent Dashboard</h2>
      
      <div style={styles.metricsGrid}>
        {metrics.map((metric, i) => (
          <div key={i} style={styles.metricCard}>
            <div style={styles.metricIcon}>{metric.icon}</div>
            <div style={styles.metricValue}>{metric.value}</div>
            <div style={styles.metricLabel}>{metric.label}</div>
            <div style={styles.metricTrend}>{metric.trend}</div>
          </div>
        ))}
      </div>

      <div style={styles.welcomeCard}>
        <h3 style={styles.welcomeTitle}>Welcome back, {agent.full_name}!</h3>
        <p style={styles.welcomeText}>
          You're doing great today. Keep up the excellent work!
        </p>
        <div style={styles.tipBox}>
          💡 <strong>Tip:</strong> Use keyboard shortcuts in Manual mode for faster dialing
        </div>
      </div>
    </div>
  );
}
