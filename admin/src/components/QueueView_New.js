import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { fetchCampaigns, createCampaign, updateCampaign, deleteCampaign, applyFreeSWITCHConfig } from '../services/adminService';
import { Server, Power, PowerOff, Search, ArrowUp, ArrowDown } from 'lucide-react';

const QueueView = () => {
    const [campaigns, setCampaigns] = useState([]);
    const [filteredCampaigns, setFilteredCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [ftpModal, setFtpModal] = useState({ visible: false, campaign: null });
    const [editModal, setEditModal] = useState({ visible: false, campaign: null, formData: null });
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });

    const [newCampaign, setNewCampaign] = useState({
        name: '', campaign_type: 'Inbound', dialer_wrapup_time: 30, queue_timeout: 60,
        csat_feedback_enabled: false, campaign_name: '', dialplan: 'XML',
        queue_strategy: 'ring_all', softphone_heartbeat: 30, webrtc_login: false
    });

    useEffect(() => { loadCampaigns(); }, []);

    useEffect(() => {
        let filtered = [...campaigns];
        if (searchTerm) {
            filtered = filtered.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
        }
        filtered.sort((a, b) => {
            let aVal = a[sortConfig.key];
            let bVal = b[sortConfig.key];
            if (typeof aVal === 'boolean') {
                aVal = aVal ? 1 : 0;
                bVal = bVal ? 1 : 0;
            }
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
            const enriched = data.map(c => ({ ...c, is_active: c.is_active !== undefined ? c.is_active : true }));
            setCampaigns(enriched);
            setError(null);
        } catch (err) {
            setError('Failed to load campaigns');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const toggleActive = async (campaign) => {
        const newStatus = !campaign.is_active;
        const updatedCampaign = { ...campaign, is_active: newStatus };
        try {
            await updateCampaign(campaign.id, {
                ...updatedCampaign,
                dialer_wrapup_time: parseInt(updatedCampaign.dialer_wrapup_time),
                queue_timeout: parseInt(updatedCampaign.queue_timeout),
                softphone_heartbeat: parseInt(updatedCampaign.softphone_heartbeat),
            });
            setCampaigns(prev => prev.map(c => c.id === campaign.id ? updatedCampaign : c));
            alert(`Campaign ${newStatus ? 'activated' : 'deactivated'}`);
        } catch (err) {
            alert('Failed to update status: ' + (err.response?.data?.detail || err.message));
        }
    };

    const applyToFreeSWITCH = async () => {
        try {
            await applyFreeSWITCHConfig();
            alert('FreeSWITCH configuration updated and reloaded successfully.');
        } catch (err) {
            console.error('Apply to FreeSWITCH failed:', err);
            alert('Failed to update FreeSWITCH: ' + (err.response?.data?.detail || err.message));
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this campaign?')) return;
        try {
            await deleteCampaign(id);
            loadCampaigns();
        } catch (err) {
            alert('Delete failed: ' + (err.response?.data?.detail || err.message));
        }
    };

    const handleAdd = async () => {
        if (!newCampaign.name.trim()) return alert('Campaign Name is required');
        try {
            await createCampaign({
                name: newCampaign.name, campaign_type: newCampaign.campaign_type,
                dialer_wrapup_time: parseInt(newCampaign.dialer_wrapup_time),
                queue_timeout: parseInt(newCampaign.queue_timeout),
                csat_feedback_enabled: newCampaign.csat_feedback_enabled,
                campaign_name: newCampaign.campaign_name || newCampaign.name,
                dialplan: newCampaign.dialplan, queue_strategy: newCampaign.queue_strategy,
                softphone_heartbeat: parseInt(newCampaign.softphone_heartbeat),
                webrtc_login: newCampaign.webrtc_login,
                is_active: true
            });
            setShowAddForm(false);
            setNewCampaign({
                name: '', campaign_type: 'Inbound', dialer_wrapup_time: 30, queue_timeout: 60,
                csat_feedback_enabled: false, campaign_name: '', dialplan: 'XML',
                queue_strategy: 'ring_all', softphone_heartbeat: 30, webrtc_login: false
            });
            loadCampaigns();
        } catch (err) {
            alert('Create failed: ' + (err.response?.data?.detail || err.message));
        }
    };

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const SortIndicator = ({ column }) => {
        if (sortConfig.key !== column) return null;
        return sortConfig.direction === 'asc' ? <ArrowUp size={12} style={{ marginLeft: '4px' }} /> : <ArrowDown size={12} style={{ marginLeft: '4px' }} />;
    };

    const openEditModal = (campaign) => {
        setEditModal({
            visible: true,
            campaign: campaign,
            formData: { ...campaign }
        });
    };

    const closeEditModal = () => {
        setEditModal({ visible: false, campaign: null, formData: null });
    };

    const handleEditFieldChange = (field, value) => {
        setEditModal(prev => ({
            ...prev,
            formData: { ...prev.formData, [field]: value }
        }));
    };

    const saveEditChanges = async () => {
        const { formData, campaign } = editModal;
        try {
            await updateCampaign(campaign.id, {
                name: formData.name,
                campaign_type: formData.campaign_type,
                dialer_wrapup_time: parseInt(formData.dialer_wrapup_time),
                queue_timeout: parseInt(formData.queue_timeout),
                csat_feedback_enabled: formData.csat_feedback_enabled,
                campaign_name: formData.campaign_name || formData.name,
                dialplan: formData.dialplan,
                queue_strategy: formData.queue_strategy,
                softphone_heartbeat: parseInt(formData.softphone_heartbeat),
                webrtc_login: formData.webrtc_login,
                is_active: formData.is_active
            });
            alert('Campaign updated successfully in database');
            loadCampaigns();
            closeEditModal();
        } catch (err) {
            alert('Update failed: ' + (err.response?.data?.detail || err.message));
        }
    };

    // --- FTP Modal Component ---
    const FtpModal = () => {
        if (!ftpModal.visible) return null;
        const { campaign } = ftpModal;
        return (
            <div style={modalOverlayStyle} onClick={() => setFtpModal({ visible: false, campaign: null })}>
                <div style={modalContentStyle} onClick={e => e.stopPropagation()}>
                    <div style={modalHeaderStyle}>
                        <h3 style={{ margin: 0 }}>FTP Settings – {campaign?.name}</h3>
                        <button onClick={() => setFtpModal({ visible: false, campaign: null })} style={closeButtonStyle}>✕</button>
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={styles.formLabel}>FTP Host</label>
                        <input type="text" style={styles.formInput} defaultValue="ftp.genztel.com" />
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={styles.formLabel}>Username</label>
                        <input type="text" style={styles.formInput} defaultValue={`queue_${campaign?.id}`} />
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={styles.formLabel}>Password</label>
                        <input type="password" style={styles.formInput} defaultValue="changeme" />
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={styles.formLabel}>Remote Path</label>
                        <input type="text" style={styles.formInput} defaultValue={`/campaigns/${campaign?.id}/`} />
                    </div>
                    <div style={modalFooterStyle}>
                        <button style={styles.cancelButton} onClick={() => setFtpModal({ visible: false, campaign: null })}>Cancel</button>
                        <button style={styles.submitButton} onClick={() => {
                            alert('FTP settings saved (integrate with your backend).');
                            setFtpModal({ visible: false, campaign: null });
                        }}>Save Settings</button>
                    </div>
                </div>
            </div>
        );
    };

    // --- Edit Modal Component ---
    const EditModalComponent = () => {
        if (!editModal.visible || !editModal.formData) return null;
        const { formData, campaign } = editModal;
        return (
            <div style={modalOverlayStyle} onClick={closeEditModal}>
                <div style={{ ...modalContentStyle, width: '650px' }} onClick={e => e.stopPropagation()}>
                    <div style={modalHeaderStyle}>
                        <h3 style={{ margin: 0 }}>Edit Campaign – {campaign.name}</h3>
                        <button onClick={closeEditModal} style={closeButtonStyle}>✕</button>
                    </div>
                    <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '8px' }}>
                        <div style={styles.formRow}>
                            <div><label style={styles.formLabel}>Campaign Name *</label><input style={styles.formInput} value={formData.name} onChange={e => handleEditFieldChange('name', e.target.value)} /></div>
                            <div><label style={styles.formLabel}>Type</label>
                                <select style={styles.formInput} value={formData.campaign_type} onChange={e => handleEditFieldChange('campaign_type', e.target.value)}>
                                    <option>Inbound</option><option>Outbound</option><option>Auto</option>
                                </select>
                            </div>
                            <div><label style={styles.formLabel}>Wrap-up (sec)</label><input type="number" style={styles.formInput} value={formData.dialer_wrapup_time} onChange={e => handleEditFieldChange('dialer_wrapup_time', e.target.value)} /></div>
                            <div><label style={styles.formLabel}>Queue Timeout (sec)</label><input type="number" style={styles.formInput} value={formData.queue_timeout} onChange={e => handleEditFieldChange('queue_timeout', e.target.value)} /></div>
                            <div><label style={styles.formLabel}><input type="checkbox" checked={formData.csat_feedback_enabled} onChange={e => handleEditFieldChange('csat_feedback_enabled', e.target.checked)} /> Enable CSAT</label></div>
                        </div>
                        <div style={styles.formRow}>
                            <div><label style={styles.formLabel}>Legacy Campaign Name</label><input style={styles.formInput} value={formData.campaign_name || ''} onChange={e => handleEditFieldChange('campaign_name', e.target.value)} placeholder="Optional" /></div>
                            <div><label style={styles.formLabel}>Dialplan</label><input style={styles.formInput} value={formData.dialplan || 'XML'} onChange={e => handleEditFieldChange('dialplan', e.target.value)} /></div>
                            <div><label style={styles.formLabel}>Queue Strategy</label>
                                <select style={styles.formInput} value={formData.queue_strategy} onChange={e => handleEditFieldChange('queue_strategy', e.target.value)}>
                                    <option>ring_all</option><option>ring_progressing</option><option>longest_idle_agent</option><option>round_robin</option><option>least_used_agent</option>
                                </select>
                            </div>
                            <div><label style={styles.formLabel}>Softphone Heartbeat (sec)</label><input type="number" style={styles.formInput} value={formData.softphone_heartbeat} onChange={e => handleEditFieldChange('softphone_heartbeat', e.target.value)} /></div>
                            <div><label style={styles.formLabel}><input type="checkbox" checked={formData.webrtc_login} onChange={e => handleEditFieldChange('webrtc_login', e.target.checked)} /> WebRTC Login</label></div>
                        </div>
                    </div>
                    <div style={modalFooterStyle}>
                        <button style={styles.cancelButton} onClick={closeEditModal}>Cancel</button>
                        <button style={styles.submitButton} onClick={saveEditChanges}>Save Changes</button>
                    </div>
                </div>
            </div>
        );
    };

    // --- Styles (inline, unchanged) ---
    const modalOverlayStyle = {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000
    };
    const modalContentStyle = {
        background: 'white', borderRadius: '20px', padding: '24px', width: '500px',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
    };
    const modalHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' };
    const modalFooterStyle = { display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' };
    const closeButtonStyle = { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' };

    const styles = {
        container: { background: 'white', borderRadius: '24px', padding: '24px', margin: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9' },
        header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' },
        title: { fontSize: '22px', fontWeight: '600', color: '#0f172a' },
        addButton: { background: '#3b82f6', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '30px', cursor: 'pointer', fontWeight: '500', fontSize: '13px' },
        searchContainer: { display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', padding: '6px 12px', borderRadius: '30px', border: '1px solid #e2e8f0' },
        searchInput: { border: 'none', background: 'transparent', outline: 'none', fontSize: '13px', width: '200px' },
        tableWrapper: { overflowX: 'auto' },
        table: { width: '100%', borderCollapse: 'collapse', minWidth: '1400px' },
        th: { textAlign: 'left', padding: '14px 12px', background: '#3b82f6', color: 'white', borderBottom: '1px solid #2563eb', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' },
        td: (isActive) => ({
            padding: '12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle', fontSize: '13px', color: '#1e293b',
            backgroundColor: isActive ? '#f0fdf4' : '#f8fafc'
        }),
        toggleButton: (isActive) => ({
            background: isActive ? '#dc2626' : '#22c55e',
            color: 'white', border: 'none', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
            fontSize: '11px', fontWeight: '500', display: 'inline-flex', alignItems: 'center', gap: '4px'
        }),
        actionButton: (disabled) => ({
            background: disabled ? '#94a3b8' : '#3b82f6',
            color: 'white', border: 'none', padding: '4px 8px', borderRadius: '6px',
            cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '11px', fontWeight: 'bold',
            minWidth: '32px', textAlign: 'center'
        }),
        ftpButton: (disabled) => ({
            background: disabled ? '#94a3b8' : '#3b82f6',
            color: 'white', border: 'none', padding: '4px 8px', borderRadius: '6px',
            cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '11px', fontWeight: '500', display: 'inline-flex', alignItems: 'center', gap: '4px'
        }),
        deleteButton: (disabled) => ({
            background: disabled ? '#94a3b8' : '#3b82f6',
            color: 'white', border: 'none', padding: '4px 8px', borderRadius: '6px',
            cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '11px', fontWeight: 'bold', minWidth: '32px', textAlign: 'center'
        }),
        addForm: { background: '#f8fafc', padding: '24px', borderRadius: '20px', marginBottom: '28px', border: '1px solid #e2e8f0' },
        formRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: '20px', marginBottom: '20px' },
        formLabel: { display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px', color: '#334155' },
        formInput: { width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '12px', fontSize: '13px' },
        formButtons: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' },
        submitButton: { background: '#3b82f6', color: 'white', border: 'none', padding: '8px 18px', borderRadius: '30px', cursor: 'pointer', fontWeight: '500' },
        cancelButton: { background: '#94a3b8', color: 'white', border: 'none', padding: '8px 18px', borderRadius: '30px', cursor: 'pointer', fontWeight: '500' },
        advancedToggle: { background: 'transparent', border: '1px solid #cbd5e1', padding: '5px 12px', borderRadius: '30px', cursor: 'pointer', fontSize: '11px', marginTop: '8px' },
        loading: { textAlign: 'center', padding: '60px', color: '#64748b', fontSize: '14px' }
    };

    if (loading) return <div style={styles.loading}>Loading campaigns...</div>;

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <h2 style={styles.title}>Queue / Campaign Management</h2>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={styles.searchContainer}>
                        <Search size={14} color="#64748b" />
                        <input type="text" placeholder="Search by customer..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={styles.searchInput} />
                    </div>
                    <button style={styles.addButton} onClick={() => setShowAddForm(!showAddForm)}>{showAddForm ? 'Cancel' : '+ Add Campaign'}</button>
                </div>
            </div>

            {error && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '12px', borderRadius: '14px', marginBottom: '20px' }}>{error}</div>}

            {showAddForm && (
                <div style={styles.addForm}>
                    <h3>New Campaign</h3>
                    <div style={styles.formRow}>
                        <div><label>Campaign Name *</label><input style={styles.formInput} value={newCampaign.name} onChange={e => setNewCampaign({...newCampaign, name: e.target.value})} /></div>
                        <div><label>Type</label>
                            <select style={styles.formInput} value={newCampaign.campaign_type} onChange={e => setNewCampaign({...newCampaign, campaign_type: e.target.value})}>
                                <option>Inbound</option><option>Outbound</option><option>Auto</option>
                            </select>
                        </div>
                        <div><label>Wrap-up (sec)</label><input type="number" style={styles.formInput} value={newCampaign.dialer_wrapup_time} onChange={e => setNewCampaign({...newCampaign, dialer_wrapup_time: e.target.value})} /></div>
                        <div><label>Queue Timeout (sec)</label><input type="number" style={styles.formInput} value={newCampaign.queue_timeout} onChange={e => setNewCampaign({...newCampaign, queue_timeout: e.target.value})} /></div>
                        <div><label><input type="checkbox" checked={newCampaign.csat_feedback_enabled} onChange={e => setNewCampaign({...newCampaign, csat_feedback_enabled: e.target.checked})} /> Enable CSAT</label></div>
                    </div>
                    <button style={styles.advancedToggle} onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? 'Hide Advanced Settings' : 'Show Advanced Settings'}</button>
                    {showAdvanced && (
                        <div style={{ marginTop: '20px' }}>
                            <div style={styles.formRow}>
                                <div><label>Legacy Campaign Name</label><input style={styles.formInput} value={newCampaign.campaign_name} onChange={e => setNewCampaign({...newCampaign, campaign_name: e.target.value})} placeholder="Optional" /></div>
                                <div><label>Dialplan</label><input style={styles.formInput} value={newCampaign.dialplan} onChange={e => setNewCampaign({...newCampaign, dialplan: e.target.value})} /></div>
                                <div><label>Queue Strategy</label>
                                    <select style={styles.formInput} value={newCampaign.queue_strategy} onChange={e => setNewCampaign({...newCampaign, queue_strategy: e.target.value})}>
                                        <option>ring_all</option><option>ring_progressing</option><option>longest_idle_agent</option><option>round_robin</option><option>least_used_agent</option>
                                    </select>
                                </div>
                                <div><label>Softphone Heartbeat (sec)</label><input type="number" style={styles.formInput} value={newCampaign.softphone_heartbeat} onChange={e => setNewCampaign({...newCampaign, softphone_heartbeat: e.target.value})} /></div>
                                <div><label><input type="checkbox" checked={newCampaign.webrtc_login} onChange={e => setNewCampaign({...newCampaign, webrtc_login: e.target.checked})} /> WebRTC Login</label></div>
                            </div>
                        </div>
                    )}
                    <div style={styles.formButtons}>
                        <button style={styles.cancelButton} onClick={() => setShowAddForm(false)}>Cancel</button>
                        <button style={styles.submitButton} onClick={handleAdd}>Create Campaign</button>
                    </div>
                </div>
            )}

            <div style={styles.tableWrapper}>
                <table style={styles.table}>
                    <thead>
                        <tr>
                            <th style={styles.th} onClick={() => requestSort('name')}>Customer <SortIndicator column="name" /></th>
                            <th style={styles.th}>S</th>
                            <th style={styles.th}>E</th>
                            <th style={styles.th}>AC</th>
                            <th style={styles.th} onClick={() => requestSort('campaign_type')}>Type <SortIndicator column="campaign_type" /></th>
                            <th style={styles.th} onClick={() => requestSort('dialer_wrapup_time')}>Wrap-up <SortIndicator column="dialer_wrapup_time" /></th>
                            <th style={styles.th} onClick={() => requestSort('queue_timeout')}>T <SortIndicator column="queue_timeout" /></th>
                            <th style={styles.th} onClick={() => requestSort('csat_feedback_enabled')}>CSAT <SortIndicator column="csat_feedback_enabled" /></th>
                            <th style={styles.th} onClick={() => requestSort('campaign_name')}>Queue_Name <SortIndicator column="campaign_name" /></th>
                            <th style={styles.th} onClick={() => requestSort('dialplan')}>Dialplan <SortIndicator column="dialplan" /></th>
                            <th style={styles.th} onClick={() => requestSort('queue_strategy')}>Strategy <SortIndicator column="queue_strategy" /></th>
                            <th style={styles.th} onClick={() => requestSort('softphone_heartbeat')}>HB (sec) <SortIndicator column="softphone_heartbeat" /></th>
                            <th style={styles.th} onClick={() => requestSort('webrtc_login')}>WebRTC <SortIndicator column="webrtc_login" /></th>
                            <th style={styles.th}>FTP</th>
                            <th style={styles.th}>D</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredCampaigns.map(c => {
                            const isActive = c.is_active;
                            const disableActions = isActive;
                            return (
                                <tr key={c.id}>
                                    <td style={styles.td(isActive)}>{c.name}</td>
                                    <td style={styles.td(isActive)}>
                                        <button style={styles.toggleButton(isActive)} onClick={() => toggleActive(c)}>
                                            {isActive ? <PowerOff size={12} /> : <Power size={12} />}
                                            {isActive ? ' Deactivate' : ' Activate'}
                                        </button>
                                    </td>
                                    <td style={styles.td(isActive)}>
                                        <button style={styles.actionButton(disableActions)} onClick={() => openEditModal(c)} disabled={disableActions} title="Edit campaign">E</button>
                                    </td>
                                    <td style={styles.td(isActive)}>
                                        <button style={styles.actionButton(disableActions)} onClick={applyToFreeSWITCH} disabled={disableActions} title="Apply to FreeSWITCH">AC</button>
                                    </td>
                                    <td style={styles.td(isActive)}>{c.campaign_type}</td>
                                    <td style={styles.td(isActive)}>{c.dialer_wrapup_time}s</td>
                                    <td style={styles.td(isActive)}>{c.queue_timeout}s</td>
                                    <td style={styles.td(isActive)}>{c.csat_feedback_enabled ? '✅ Yes' : '❌ No'}</td>
                                    <td style={styles.td(isActive)}>{c.campaign_name || '-'}</td>
                                    <td style={styles.td(isActive)}>{c.dialplan || 'XML'}</td>
                                    <td style={styles.td(isActive)}>{c.queue_strategy}</td>
                                    <td style={styles.td(isActive)}>{c.softphone_heartbeat}s</td>
                                    <td style={styles.td(isActive)}>{c.webrtc_login ? '✅ Yes' : '❌ No'}</td>
                                    <td style={styles.td(isActive)}>
                                        <button style={styles.ftpButton(disableActions)} onClick={() => setFtpModal({ visible: true, campaign: c })} disabled={disableActions} title="FTP settings">
                                            <Server size={12} /> FTP
                                        </button>
                                    </td>
                                    <td style={styles.td(isActive)}>
                                        <button style={styles.deleteButton(disableActions)} onClick={() => handleDelete(c.id)} disabled={disableActions} title="Delete campaign">D</button>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredCampaigns.length === 0 && (
                            <tr>
                                <td colSpan="15" style={{ textAlign: 'center', padding: '50px', color: '#94a3b8' }}>
                                    No campaigns found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <FtpModal />
            <EditModalComponent />
        </div>
    );
};

export default QueueView;
