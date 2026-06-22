export default function Insights({ agent, theme = 'dark' }) {
  const isDark = theme === 'dark';
  
  const stats = [
    { label: 'Total Calls', value: '342', change: '+12%', icon: '📞' },
    { label: 'Avg Duration', value: '2:45', change: '-5%', icon: '⏱️' },
    { label: 'CSAT Score', value: '4.7★', change: '+0.3', icon: '⭐' },
    { label: 'FCR Rate', value: '86%', change: '+4%', icon: '✅' },
  ];

  const weeklyData = [42, 38, 45, 52, 48, 60, 55];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const maxValue = Math.max(...weeklyData);

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
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '12px',
      marginBottom: '20px',
    },
    statCard: {
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      padding: '16px',
      borderRadius: '10px',
      textAlign: 'center',
    },
    statIcon: {
      fontSize: '24px',
      marginBottom: '8px',
    },
    statValue: {
      fontSize: '22px',
      fontWeight: '600',
      color: isDark ? '#f1f5f9' : '#1e293b',
    },
    statLabel: {
      fontSize: '11px',
      color: isDark ? '#94a3b8' : '#64748b',
      marginTop: '4px',
    },
    statChange: {
      fontSize: '10px',
      color: '#10b981',
      marginTop: '6px',
    },
    chartCard: {
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      padding: '16px',
      borderRadius: '10px',
      marginBottom: '16px',
    },
    chartTitle: {
      fontSize: '13px',
      fontWeight: '600',
      color: isDark ? '#cbd5e1' : '#475569',
      marginBottom: '16px',
    },
    chart: {
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'flex-end',
      height: '160px',
    },
    chartBarContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      flex: 1,
    },
    chartBar: {
      width: '24px',
      backgroundColor: '#3b82f6',
      borderRadius: '4px 4px 0 0',
      transition: 'height 0.3s',
    },
    chartLabel: {
      fontSize: '10px',
      color: isDark ? '#94a3b8' : '#64748b',
      marginTop: '8px',
    },
    chartValue: {
      fontSize: '9px',
      color: isDark ? '#64748b' : '#94a3b8',
      marginTop: '4px',
    },
    distributionCard: {
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      padding: '16px',
      borderRadius: '10px',
    },
    distribution: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    },
    distributionItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    },
    distributionLabel: {
      width: '70px',
      fontSize: '12px',
      color: isDark ? '#cbd5e1' : '#475569',
    },
    distributionBarContainer: {
      flex: 1,
      height: '20px',
      backgroundColor: isDark ? '#1e293b' : '#e2e8f0',
      borderRadius: '10px',
      overflow: 'hidden',
    },
    distributionBar: {
      height: '100%',
      transition: 'width 0.3s',
    },
    distributionValue: {
      width: '40px',
      fontSize: '12px',
      fontWeight: '500',
      color: isDark ? '#f1f5f9' : '#1e293b',
      textAlign: 'right',
    },
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Performance Insights</h2>
      
      <div style={styles.statsGrid}>
        {stats.map((stat, i) => (
          <div key={i} style={styles.statCard}>
            <div style={styles.statIcon}>{stat.icon}</div>
            <div style={styles.statValue}>{stat.value}</div>
            <div style={styles.statLabel}>{stat.label}</div>
            <div style={styles.statChange}>{stat.change}</div>
          </div>
        ))}
      </div>

      <div style={styles.chartCard}>
        <div style={styles.chartTitle}>Weekly Call Volume</div>
        <div style={styles.chart}>
          {weeklyData.map((value, i) => (
            <div key={i} style={styles.chartBarContainer}>
              <div style={{ ...styles.chartBar, height: `${(value / maxValue) * 120}px` }}></div>
              <div style={styles.chartLabel}>{days[i]}</div>
              <div style={styles.chartValue}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.distributionCard}>
        <div style={styles.chartTitle}>Call Distribution</div>
        <div style={styles.distribution}>
          <div style={styles.distributionItem}>
            <div style={styles.distributionLabel}>Inbound</div>
            <div style={styles.distributionBarContainer}>
              <div style={{ ...styles.distributionBar, width: '70%', backgroundColor: '#3b82f6' }}></div>
            </div>
            <div style={styles.distributionValue}>287</div>
          </div>
          <div style={styles.distributionItem}>
            <div style={styles.distributionLabel}>Outbound</div>
            <div style={styles.distributionBarContainer}>
              <div style={{ ...styles.distributionBar, width: '30%', backgroundColor: '#10b981' }}></div>
            </div>
            <div style={styles.distributionValue}>55</div>
          </div>
        </div>
      </div>
    </div>
  );
}
