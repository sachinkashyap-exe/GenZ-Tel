import React, { useState, useEffect } from 'react';
import { fetchCampaigns, createCampaign, updateCampaign, deleteCampaign, applyFreeSWITCHConfig } from '../services/adminService';
import { Server, Search, Edit2, Trash2, CheckCircle2, XCircle, Globe } from 'lucide-react';
import axios from 'axios';

const QueueView = () => {
    const [campaigns, setCampaigns] = useState([]);
    const [filteredCampaigns, setFilteredCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [applying, setApplying] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [ftpModal, setFtpModal] = useState({ visible: false, campaign: null, formData: { host: 'ftp.genztel.com', username: '', password: '', port: '21', remote_path: '/' } });
    const [editModal, setEditModal] = useState({ visible: false, campaign: null, formData: null });
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });

    const [newCampaign, setNewCampaign] = useState({
        name: '', campaign_name: '', campaign_type: 'Inbound', dialer_wrapup_time: 30,
        queue_timeout: 60, csat_feedback_enabled: 0, queue_strategy: 'ring_all',
        softphone_heartbeat: 30, webrtc_login: 0, dialplan: 'XML', is_active: 1
    });

    useEffect(() => { loadCampaigns(); }, []);

    useEffect(() => {
        let filtered = [...campaigns];
        if (searchTerm) filtered = filtered.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
        filtered.sort((a, b) => {
            let aVal = a[sortConfig.key]; let bVal = b[sortConfig.key];
            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
        setFilteredCampaigns(filtered);
    }, [campaigns, searchTerm, sortConfig]);

    const loadCampaigns = async () => {
        try {
            setLoading(true);
            const data = await fetchCampaigns();
            setCampaigns(data.map(c => ({ ...c, is_active: c.is_active === 1 || c.is_active === true })));
        } catch (err) { console.error(err); } finally { setLoading(false); }
    };

    const toggleActive = async (campaign) => {
        const newStatus = !campaign.is_active;
        const payload = {
            ...campaign,
            is_active: newStatus,
            dialer_wrapup_time: parseInt(campaign.dialer_wrapup_time),
            queue_timeout: parseInt(campaign.queue_timeout),
            softphone_heartbeat: parseInt(campaign.softphone_heartbeat),
            csat_feedback_enabled: campaign.csat_feedback_enabled ? 1 : 0,
            webrtc_login: campaign.webrtc_login ? 1 : 0
        };
        try {
            await updateCampaign(campaign.id, payload);
            loadCampaigns();
        } catch (err) {
            alert("Failed to toggle status: " + (err.response?.data?.detail || err.message));
        }
    };

    const handleAdd = async () => {
        if (!newCampaign.name) return alert("Name is required");
        try {
            await createCampaign({
                ...newCampaign,
                dialer_wrapup_time: parseInt(newCampaign.dialer_wrapup_time),
                queue_timeout: parseInt(newCampaign.queue_timeout),
                softphone_heartbeat: parseInt(newCampaign.softphone_heartbeat),
                csat_feedback_enabled: newCampaign.csat_feedback_enabled ? 1 : 0,
                webrtc_login: newCampaign.webrtc_login ? 1 : 0,
                is_active: 1
            });
            setShowAddForm(false);
            loadCampaigns();
        } catch (err) { alert("Add failed: " + (err.response?.data?.detail || err.message)); }
    };

    const saveEditChanges = async () => {
        try {
            await updateCampaign(editModal.campaign.id, {
                ...editModal.formData,
                dialer_wrapup_time: parseInt(editModal.formData.dialer_wrapup_time),
                queue_timeout: parseInt(editModal.formData.queue_timeout),
                softphone_heartbeat: parseInt(editModal.formData.softphone_heartbeat),
                csat_feedback_enabled: editModal.formData.csat_feedback_enabled ? 1 : 0,
                webrtc_login: editModal.formData.webrtc_login ? 1 : 0
            });
            setEditModal({ visible: false, campaign: null, formData: null });
            loadCampaigns();
        } catch (err) { alert("Update failed: " + (err.response?.data?.detail || err.message)); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("⚠️ Delete this campaign permanently? This action cannot be undone.")) return;
        try {
            await deleteCampaign(id);
            loadCampaigns();
        } catch (err) {
            alert("Delete failed: " + (err.response?.data?.detail || err.message));
        }
    };

    const saveFtpSettings = async (campaignId, formData) => {
        try {
            await axios.post(`/admin/queues/${campaignId}/ftp`, formData);
            alert('FTP settings saved successfully');
            setFtpModal({ visible: false, campaign: null, formData: null });
        } catch (err) {
            alert("Failed to save FTP settings: " + (err.response?.data?.detail || err.message));
        }
    };

    const handleApplyFreeSwitch = async () => {
        setApplying(true);
        try {
            await applyFreeSWITCHConfig();
            alert('FreeSWITCH configuration applied successfully');
        } catch (err) {
            alert("Apply failed: " + (err.response?.data?.detail || err.message));
        } finally {
            setApplying(false);
        }
    };

    const styles = {
        container: {
            background: '#060b13',
            minHeight: '100vh',
            padding: '80px 40px 40px 40px',  // INCREASED TOP PADDING
            color: '#fff',
            boxSizing: 'border-box'
        },
        header: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '30px',
            flexWrap: 'wrap',
            gap: '15px'
        },
        card: {
            background: '#0b121f',
            borderRadius: '20px',
            border: '1px solid #1e293b',
            overflow: 'auto'
        },
        table: {
            width: '100%',
            borderCollapse: 'collapse',
            minWidth: '800px'
        },
        th: {
            padding: '16px 20px',
            color: '#475569',
            fontSize: '11px',
            textTransform: 'uppercase',
            textAlign: 'left',
            borderBottom: '1px solid #1e293b'
        },
        td: {
            padding: '16px 20px',
            fontSize: '14px',
            borderBottom: '1px solid #1e293b'
        },
        statusBtn: (active) => ({
            background: active ? '#ef444420' : '#10b98120',
            color: active ? '#ef4444' : '#10b981',
            border: `1px solid ${active ? '#ef444440' : '#10b98140'}`,
            padding: '6px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 'bold',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px'
        }),
        actionBtn: (disabled, color) => ({
            background: '#1e293b',
            color: disabled ? '#334155' : (color || '#94a3b8'),
            border: 'none',
            padding: '8px',
            borderRadius: '8px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            marginLeft: '6px',
            opacity: disabled ? 0.3 : 1,
            transition: '0.2s'
        }),
        modalOverlay: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            backdropFilter: 'blur(8px)'
        },
        modalBox: {
            background: '#0b121f',
            padding: '30px',
            borderRadius: '24px',
            width: '800px',
            maxWidth: '90vw',
            border: '1px solid #1e293b',
            maxHeight: '85vh',
            overflowY: 'auto',
            boxSizing: 'border-box'
        },
        formGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '20px',
            marginBottom: '20px'
        },
        input: {
            width: '100%',
            padding: '12px',
            background: '#060b13',
            border: '1px solid #1e293b',
            borderRadius: '12px',
            color: '#fff',
            marginTop: '6px',
            outline: 'none',
            boxSizing: 'border-box'
        },
        label: {
            fontSize: '12px',
            color: '#475569',
            display: 'block',
            marginBottom: '4px'
        }
    };

    if (loading) {
        return (
            <div style={{ ...styles.container, textAlign: 'center', paddingTop: '120px' }}>
                Loading campaigns...
            </div>
        );
    }

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <h1 style={{ margin: 0 }}>Campaign Management</h1>
                <div style={{ display: 'flex', gap: '15px' }}>
                    <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: '12px', display: 'flex', alignItems: 'center', padding: '0 15px' }}>
                        <Search size={18} color="#475569" />
                        <input
                            style={{ background: 'transparent', border: 'none', color: '#fff', padding: '10px', outline: 'none' }}
                            placeholder="Search..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button
                        style={{ background: '#0084ff', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}
                        onClick={() => setShowAddForm(true)}
                    >
                        + Add Campaign
                    </button>
                </div>
            </div>

            <div style={styles.card}>
                <table style={styles.table}>
                    <thead>
                        <tr>
                            <th style={styles.th}>Customer</th>
                            <th style={styles.th}>Status</th>
                            <th style={styles.th}>Type</th>
                            <th style={styles.th}>Strategy</th>
                            <th style={styles.th}>Wrap-Up</th>
                            <th style={styles.th}>HB</th>
                            <th style={{ ...styles.th, textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredCampaigns.map(c => (
                            <tr key={c.id}>
                                <td style={styles.td}>
                                    <b>{c.name}</b><br />
                                    <small style={{ color: '#475569' }}>{c.campaign_name}</small>
                                </td>
                                <td style={styles.td}>
                                    <button style={styles.statusBtn(c.is_active)} onClick={() => toggleActive(c)}>
                                        {c.is_active ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                                        {c.is_active ? ' Deactivate' : ' Activate'}
                                    </button>
                                </td>
                                <td style={styles.td}>{c.campaign_type}</td>
                                <td style={styles.td}><span style={{ color: '#0084ff' }}>{c.queue_strategy}</span></td>
                                <td style={styles.td}>{c.dialer_wrapup_time}s</td>
                                <td style={styles.td}>{c.softphone_heartbeat}s</td>
                                <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    <button style={styles.actionBtn(c.is_active)} disabled={c.is_active} onClick={() => setEditModal({ visible: true, campaign: c, formData: { ...c } })} title="Edit campaign"><Edit2 size={16} /></button>
                                    <button style={styles.actionBtn(c.is_active)} disabled={c.is_active || applying} onClick={handleApplyFreeSwitch} title="Apply configuration to FreeSWITCH">
                                        {applying ? '...' : <Server size={16} />}
                                    </button>
                                    <button style={styles.actionBtn(c.is_active, '#0084ff')} disabled={c.is_active} onClick={() => setFtpModal({
                                        visible: true,
                                        campaign: c,
                                        formData: {
                                            host: 'ftp.genztel.com',
                                            username: `queue_${c.id}`,
                                            password: '',
                                            port: '21',
                                            remote_path: `/campaigns/${c.id}/`
                                        }
                                    })} title="Configure FTP settings"><Globe size={16} /></button>
                                    <button style={styles.actionBtn(c.is_active, '#ef4444')} disabled={c.is_active} onClick={() => handleDelete(c.id)} title="Delete campaign"><Trash2 size={16} /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ADD CAMPAIGN MODAL */}
            {showAddForm && (
                <div style={styles.modalOverlay}>
                    <div style={styles.modalBox}>
                        <h3>New Campaign</h3>
                        <div style={styles.formGrid}>
                            <div><label style={styles.label}>Name *</label><input style={styles.input} value={newCampaign.name} onChange={e => setNewCampaign({ ...newCampaign, name: e.target.value })} /></div>
                            <div><label style={styles.label}>Internal Name</label><input style={styles.input} value={newCampaign.campaign_name} onChange={e => setNewCampaign({ ...newCampaign, campaign_name: e.target.value })} /></div>
                            <div><label style={styles.label}>Type</label>
                                <select style={styles.input} value={newCampaign.campaign_type} onChange={e => setNewCampaign({ ...newCampaign, campaign_type: e.target.value })}>
                                    <option>Inbound</option><option>Outbound</option><option>Auto</option>
                                </select>
                            </div>
                            <div><label style={styles.label}>Strategy</label>
                                <select style={styles.input} value={newCampaign.queue_strategy} onChange={e => setNewCampaign({ ...newCampaign, queue_strategy: e.target.value })}>
                                    <option>ring_all</option><option>round_robin</option><option>longest_idle_agent</option>
                                </select>
                            </div>
                            <div><label style={styles.label}>Wrap-up (s)</label><input type="number" style={styles.input} value={newCampaign.dialer_wrapup_time} onChange={e => setNewCampaign({ ...newCampaign, dialer_wrapup_time: e.target.value })} /></div>
                            <div><label style={styles.label}>Queue Timeout (s)</label><input type="number" style={styles.input} value={newCampaign.queue_timeout} onChange={e => setNewCampaign({ ...newCampaign, queue_timeout: e.target.value })} /></div>
                            <div><label style={styles.label}>Heartbeat (s)</label><input type="number" style={styles.input} value={newCampaign.softphone_heartbeat} onChange={e => setNewCampaign({ ...newCampaign, softphone_heartbeat: e.target.value })} /></div>
                            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                <label><input type="checkbox" checked={newCampaign.csat_feedback_enabled === 1} onChange={e => setNewCampaign({ ...newCampaign, csat_feedback_enabled: e.target.checked ? 1 : 0 })} /> Enable CSAT</label>
                                <label><input type="checkbox" checked={newCampaign.webrtc_login === 1} onChange={e => setNewCampaign({ ...newCampaign, webrtc_login: e.target.checked ? 1 : 0 })} /> WebRTC Login</label>
                            </div>
                        </div>
                        <div style={{ marginTop: '30px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                            <button style={{ background: '#1e293b', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '12px', cursor: 'pointer' }} onClick={() => setShowAddForm(false)}>Cancel</button>
                            <button style={{ background: '#0084ff', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '12px', cursor: 'pointer' }} onClick={handleAdd}>Save Campaign</button>
                        </div>
                    </div>
                </div>
            )}

            {/* EDIT CAMPAIGN MODAL */}
            {editModal.visible && (
                <div style={styles.modalOverlay}>
                    <div style={styles.modalBox}>
                        <h3>Edit Campaign: {editModal.campaign.name}</h3>
                        <div style={styles.formGrid}>
                            <div><label style={styles.label}>Name</label><input style={styles.input} value={editModal.formData.name} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, name: e.target.value } })} /></div>
                            <div><label style={styles.label}>Internal Name</label><input style={styles.input} value={editModal.formData.campaign_name || ''} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, campaign_name: e.target.value } })} /></div>
                            <div><label style={styles.label}>Type</label>
                                <select style={styles.input} value={editModal.formData.campaign_type} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, campaign_type: e.target.value } })}>
                                    <option>Inbound</option><option>Outbound</option><option>Auto</option>
                                </select>
                            </div>
                            <div><label style={styles.label}>Strategy</label>
                                <select style={styles.input} value={editModal.formData.queue_strategy} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, queue_strategy: e.target.value } })}>
                                    <option>ring_all</option><option>round_robin</option><option>longest_idle_agent</option>
                                </select>
                            </div>
                            <div><label style={styles.label}>Wrap-up (s)</label><input type="number" style={styles.input} value={editModal.formData.dialer_wrapup_time} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, dialer_wrapup_time: e.target.value } })} /></div>
                            <div><label style={styles.label}>Queue Timeout (s)</label><input type="number" style={styles.input} value={editModal.formData.queue_timeout} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, queue_timeout: e.target.value } })} /></div>
                            <div><label style={styles.label}>Heartbeat (s)</label><input type="number" style={styles.input} value={editModal.formData.softphone_heartbeat} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, softphone_heartbeat: e.target.value } })} /></div>
                            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                <label><input type="checkbox" checked={editModal.formData.csat_feedback_enabled === 1} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, csat_feedback_enabled: e.target.checked ? 1 : 0 } })} /> CSAT Enabled</label>
                                <label><input type="checkbox" checked={editModal.formData.webrtc_login === 1} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, webrtc_login: e.target.checked ? 1 : 0 } })} /> WebRTC Login</label>
                            </div>
                        </div>
                        <div style={{ marginTop: '30px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                            <button style={{ background: '#1e293b', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '12px', cursor: 'pointer' }} onClick={() => setEditModal({ visible: false })}>Cancel</button>
                            <button style={{ background: '#0084ff', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '12px', cursor: 'pointer' }} onClick={saveEditChanges}>Save Changes</button>
                        </div>
                    </div>
                </div>
            )}

            {/* FTP MODAL */}
            {ftpModal.visible && (
                <div style={styles.modalOverlay}>
                    <div style={{ ...styles.modalBox, width: '500px' }}>
                        <h3>FTP Configuration – {ftpModal.campaign?.name}</h3>
                        <div style={styles.formGrid}>
                            <div><label style={styles.label}>Host</label><input style={styles.input} value={ftpModal.formData.host} onChange={e => setFtpModal({ ...ftpModal, formData: { ...ftpModal.formData, host: e.target.value } })} /></div>
                            <div><label style={styles.label}>Port</label><input style={styles.input} value={ftpModal.formData.port} onChange={e => setFtpModal({ ...ftpModal, formData: { ...ftpModal.formData, port: e.target.value } })} /></div>
                            <div><label style={styles.label}>Username</label><input style={styles.input} value={ftpModal.formData.username} onChange={e => setFtpModal({ ...ftpModal, formData: { ...ftpModal.formData, username: e.target.value } })} /></div>
                            <div><label style={styles.label}>Password</label><input type="password" style={styles.input} value={ftpModal.formData.password} onChange={e => setFtpModal({ ...ftpModal, formData: { ...ftpModal.formData, password: e.target.value } })} /></div>
                            <div><label style={styles.label}>Remote Path</label><input style={styles.input} value={ftpModal.formData.remote_path} onChange={e => setFtpModal({ ...ftpModal, formData: { ...ftpModal.formData, remote_path: e.target.value } })} /></div>
                        </div>
                        <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                            <button style={{ background: '#1e293b', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '12px', cursor: 'pointer' }} onClick={() => setFtpModal({ visible: false, campaign: null, formData: null })}>Cancel</button>
                            <button style={{ background: '#0084ff', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '12px', cursor: 'pointer' }} onClick={() => saveFtpSettings(ftpModal.campaign.id, ftpModal.formData)}>Save Settings</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default QueueView;
