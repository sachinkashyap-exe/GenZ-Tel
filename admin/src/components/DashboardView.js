import React, { useEffect, useState } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer
} from 'recharts';
import { Loader2, AlertCircle, PhoneIncoming, Users, PhoneMissed, PhoneCall, Star } from 'lucide-react';

import {
    fetchDashboardStats,
    fetchDashboardChart,
    fetchQueueStatus,
    fetchRecentCalls
} from '../services/adminService';

const DashboardView = () => {
    const [data, setData] = useState({ stats: null, chart: [], queues: [], recent: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchAllData = async () => {
            try {
                const [stats, chart, queues, recent] = await Promise.all([
                    fetchDashboardStats(),
                    fetchDashboardChart(7),
                    fetchQueueStatus(),
                    fetchRecentCalls(5)
                ]);

                setData({
                    stats: stats,
                    chart: chart,      // already formatted by the service
                    queues: queues,
                    recent: recent
                });
                setLoading(false);
            } catch (err) {
                console.error("Dashboard Load Error:", err);
                setError("Could not connect to Backend API");
                setLoading(false);
            }
        };

        fetchAllData();
        const interval = setInterval(fetchAllData, 30000);
        return () => clearInterval(interval);
    }, []);

    if (loading) return (
        <div style={{ display: 'flex', height: '70vh', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '15px' }}>
            <Loader2 className="animate-spin" size={40} color="#3b82f6" />
            <p style={{ color: '#64748b', fontWeight: '500' }}>Connecting to GenZ Tel Systems...</p>
        </div>
    );

    if (error) return (
        <div style={{ padding: '50px', textAlign: 'center', color: '#ef4444' }}>
            <AlertCircle size={40} style={{ marginBottom: '10px' }} />
            <h3>{error}</h3>
            <button onClick={() => window.location.reload()} style={{ marginTop: '10px', padding: '8px 20px', borderRadius: '30px', border: 'none', background: '#3b82f6', color: 'white', cursor: 'pointer' }}>Retry Connection</button>
        </div>
    );

    const cardStyle = {
        background: 'white',
        borderRadius: '20px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
        padding: '20px',
        marginBottom: '20px',
        transition: 'all 0.2s',
        border: '1px solid #f1f5f9',
    };

    const statCardStyle = (borderColor) => ({
        background: 'white',
        borderRadius: '16px',
        padding: '16px 20px',
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        borderLeft: `4px solid ${borderColor}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
    });

    return (
        <div style={{ backgroundColor: '#f8fafc', minHeight: '100vh', padding: '24px' }}>
            {/* KPI Row */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
                {[
                    { label: 'Total Calls', val: data.stats.total_calls, color: '#3b82f6', icon: <PhoneIncoming size={18} />, bg: '#eff6ff' },
                    { label: 'Answered', val: data.stats.answered_calls, color: '#22c55e', icon: <PhoneCall size={18} />, bg: '#f0fdf4' },
                    { label: 'Missed', val: data.stats.missed_calls, color: '#ef4444', icon: <PhoneMissed size={18} />, bg: '#fef2f2' },
                    { label: 'Active Agents', val: data.stats.active_agents, color: '#8b5cf6', icon: <Users size={18} />, bg: '#f5f3ff' },
                    { label: 'Avg CSAT', val: data.stats.csat_score, color: '#f59e0b', icon: <Star size={18} />, bg: '#fffbeb' },
                ].map((stat, i) => (
                    <div key={i} style={statCardStyle(stat.color)}>
                        <div style={{ background: stat.bg, padding: '8px', borderRadius: '12px', color: stat.color }}>{stat.icon}</div>
                        <div>
                            <div style={{ fontSize: '24px', fontWeight: '700', lineHeight: 1.2 }}>{stat.val}</div>
                            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>{stat.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr', gap: '20px' }}>
                {/* Left column */}
                <div>
                    <div style={cardStyle}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                            <span style={{ fontSize: '15px', fontWeight: '600' }}>Call Volume (Last 7 Days)</span>
                            <div style={{ fontSize: '11px', display: 'flex', gap: '12px' }}>
                                <span style={{ color: '#3b82f6' }}>● Total</span>
                                <span style={{ color: '#22c55e' }}>● Answered</span>
                            </div>
                        </div>
                        <ResponsiveContainer width="100%" height={320}>
                            <AreaChart data={data.chart}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} style={{ fontSize: '10px' }} />
                                <YAxis axisLine={false} tickLine={false} style={{ fontSize: '10px' }} />
                                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }} />
                                <Area type="monotone" dataKey="total" stroke="#3b82f6" fill="#3b82f610" strokeWidth={2} />
                                <Area type="monotone" dataKey="answered" stroke="#22c55e" fill="#22c55e10" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    <div style={cardStyle}>
                        <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px' }}>Agent Availability</div>
                        <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                            <div><div style={{ fontSize: '22px', fontWeight: 'bold', color: '#22c55e' }}>{data.stats.available_agents}</div><div style={{ fontSize: '11px', color: '#64748b' }}>Available</div></div>
                            <div><div style={{ fontSize: '22px', fontWeight: 'bold', color: '#3b82f6' }}>{data.stats.agents_on_call}</div><div style={{ fontSize: '11px', color: '#64748b' }}>On Call</div></div>
                            <div><div style={{ fontSize: '22px', fontWeight: 'bold', color: '#f59e0b' }}>{data.stats.agents_on_break}</div><div style={{ fontSize: '11px', color: '#64748b' }}>Break</div></div>
                            <div><div style={{ fontSize: '22px', fontWeight: 'bold', color: '#94a3b8' }}>{data.stats.logged_out_agents}</div><div style={{ fontSize: '11px', color: '#64748b' }}>Offline</div></div>
                        </div>
                    </div>
                </div>

                {/* Right column */}
                <div>
                    <div style={cardStyle}>
                        <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px' }}>Team Performance (SLA)</div>
                        {data.queues.map((q, i) => (
                            <div key={i} style={{ marginBottom: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '5px' }}>
                                    <span>{q.queue_name}</span>
                                    <span style={{ fontWeight: 'bold' }}>{q.service_level}%</span>
                                </div>
                                <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '10px' }}>
                                    <div style={{ height: '100%', width: `${q.service_level}%`, background: q.service_level > 80 ? '#22c55e' : '#f59e0b', borderRadius: '10px' }} />
                                </div>
                            </div>
                        ))}
                    </div>

                    <div style={cardStyle}>
                        <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Queue Wait Times</div>
                        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>
                                    <th style={{ textAlign: 'left', paddingBottom: '8px' }}>Queue</th><th>Waiting</th><th>Avg Wait</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.queues.map((q, i) => (
                                    <tr key={i} style={{ borderBottom: '1px solid #fafafa' }}>
                                        <td style={{ padding: '10px 0', fontWeight: '500' }}>{q.queue_name}</td>
                                        <td>{q.waiting_calls}</td>
                                        <td>{q.avg_wait_time}s</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div style={cardStyle}>
                        <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Recent Calls</div>
                        {data.recent.map((call, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f8fafc' }}>
                                <div>
                                    <div style={{ fontSize: '13px', fontWeight: '500' }}>{call.phone_number}</div>
                                    <div style={{ fontSize: '10px', color: '#64748b' }}>Agent: {call.agent_name}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <span style={{ background: call.status === 'Completed' ? '#dcfce7' : '#fee2e2', color: call.status === 'Completed' ? '#166534' : '#991b1b', padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: '500' }}>{call.status}</span>
                                    <div style={{ fontSize: '9px', marginTop: '4px' }}>{call.duration}</div>
                                </div>
                            </div>
                        ))}
                        <div style={{ textAlign: 'center', marginTop: '16px' }}>
                            <button style={{ border: 'none', background: 'none', color: '#3b82f6', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>View All Logs →</button>
                        </div>
                    </div>

                    <div style={cardStyle}>
                        <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '6px' }}>Global Handle Time</div>
                        <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#0f172a' }}>{data.stats.avg_handle_time}</div>
                        <div style={{ fontSize: '12px', color: data.stats.avg_handle_time_change < 0 ? '#22c55e' : '#ef4444', marginTop: '4px' }}>
                            {data.stats.avg_handle_time_change}% from last week
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DashboardView;
