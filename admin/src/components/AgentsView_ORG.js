import React, { useState, useEffect } from 'react';
import {
    fetchAgents, createAgent, updateAgent, deleteAgent, applyFreeSWITCHConfig
} from '../services/adminService';
import { Search, Edit2, Trash2, UserPlus, RefreshCw, Globe } from 'lucide-react';

const AgentsView = () => {
    const [agents, setAgents] = useState([]);
    const [filteredAgents, setFilteredAgents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [applying, setApplying] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [editModal, setEditModal] = useState({ visible: false, agent: null, formData: null });
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'agent_id', direction: 'asc' });

    const [newAgent, setNewAgent] = useState({
        agent_id: '',
        agent_identity: '',
        full_name: '',
        extension: '',
        sip_password: '',
        allow_remote_login: 0,
        agent_type: 'Normal'
    });

    useEffect(() => { loadAgents(); }, []);

    useEffect(() => {
        let filtered = [...agents];
        if (searchTerm) {
            filtered = filtered.filter(a =>
                a.agent_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                a.full_name.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }
        filtered.sort((a, b) => {
            let aVal = a[sortConfig.key];
            let bVal = b[sortConfig.key];
            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
        setFilteredAgents(filtered);
    }, [agents, searchTerm, sortConfig]);

    const loadAgents = async () => {
        try {
            setLoading(true);
            const data = await fetchAgents();
            setAgents(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newAgent.agent_id) return alert("Agent ID is required");
        if (!newAgent.full_name) return alert("Full name is required");
        if (!newAgent.extension) return alert("Extension is required");
        try {
            await createAgent({
                ...newAgent,
                allow_remote_login: newAgent.allow_remote_login ? 1 : 0
            });
            setShowAddForm(false);
            setNewAgent({
                agent_id: '', agent_identity: '', full_name: '', extension: '',
                sip_password: '', allow_remote_login: 0, agent_type: 'Normal'
            });
            loadAgents();
        } catch (err) {
            alert("Add failed: " + (err.response?.data?.detail || err.message));
        }
    };

    const saveEditChanges = async () => {
        try {
            await updateAgent(editModal.agent.agent_id, {
                ...editModal.formData,
                allow_remote_login: editModal.formData.allow_remote_login ? 1 : 0
            });
            setEditModal({ visible: false, agent: null, formData: null });
            loadAgents();
        } catch (err) {
            alert("Update failed: " + (err.response?.data?.detail || err.message));
        }
    };

    const handleDelete = async (agentId, fullName) => {
        if (!window.confirm(`⚠️ Delete agent "${fullName}"? This action cannot be undone.`)) return;
        try {
            await deleteAgent(agentId);
            loadAgents();
        } catch (err) {
            alert("Delete failed: " + (err.response?.data?.detail || err.message));
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

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const SortIndicator = ({ column }) => {
        if (sortConfig.key !== column) return null;
        return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
    };

    const styles = {
        outerContainer: {
            background: '#060b13',
            minHeight: '100vh',
            width: '100%'
        },
        innerWrapper: {
            padding: '80px 40px 40px 40px',
            color: '#fff',
            boxSizing: 'border-box',
            width: '100%'
        },
        header: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '30px',
            flexWrap: 'wrap',
            gap: '15px'
        },
        title: {
            margin: 0,
            fontSize: '28px',
            fontWeight: '600'
        },
        searchContainer: {
            background: '#111827',
            border: '1px solid #1e293b',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 15px'
        },
        searchInput: {
            background: 'transparent',
            border: 'none',
            color: '#fff',
            padding: '10px',
            outline: 'none',
            width: '200px'
        },
        buttonPrimary: {
            background: '#0084ff',
            color: '#fff',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '12px',
            cursor: 'pointer',
            fontWeight: 'bold',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px'
        },
        buttonSecondary: {
            background: '#1e293b',
            color: '#94a3b8',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '12px',
            cursor: 'pointer',
            fontWeight: 'bold',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px'
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
            borderBottom: '1px solid #1e293b',
            cursor: 'pointer',
            userSelect: 'none'
        },
        td: {
            padding: '16px 20px',
            fontSize: '14px',
            borderBottom: '1px solid #1e293b'
        },
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
            width: '700px',
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
        label: {
            fontSize: '12px',
            color: '#475569',
            display: 'block',
            marginBottom: '4px'
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
        select: {
            width: '100%',
            padding: '12px',
            background: '#060b13',
            border: '1px solid #1e293b',
            borderRadius: '12px',
            color: '#fff',
            marginTop: '6px',
            outline: 'none'
        },
        checkboxLabel: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '20px',
            fontSize: '13px'
        },
        buttonGroup: {
            marginTop: '30px',
            display: 'flex',
            gap: '10px',
            justifyContent: 'flex-end'
        }
    };

    if (loading) {
        return (
            <div style={styles.outerContainer}>
                <div style={{ ...styles.innerWrapper, textAlign: 'center', paddingTop: '120px' }}>
                    Loading agents...
                </div>
            </div>
        );
    }

    return (
        <div style={styles.outerContainer}>
            <div style={styles.innerWrapper}>
                <div style={styles.header}>
                    <h1 style={styles.title}>Agent Management</h1>
                    <div style={{ display: 'flex', gap: '15px' }}>
                        <div style={styles.searchContainer}>
                            <Search size={18} color="#475569" />
                            <input
                                style={styles.searchInput}
                                placeholder="Search by ID or name..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <button style={styles.buttonPrimary} onClick={() => setShowAddForm(true)}>
                            <UserPlus size={16} /> Add Agent
                        </button>
                        <button style={styles.buttonSecondary} onClick={handleApplyFreeSwitch} disabled={applying}>
                            <RefreshCw size={16} /> {applying ? 'Applying...' : 'Apply to FreeSWITCH'}
                        </button>
                    </div>
                </div>

                <div style={styles.card}>
                    <table style={styles.table}>
                        <thead>
                            <tr>
                                <th style={styles.th} onClick={() => requestSort('agent_id')}>Agent ID <SortIndicator column="agent_id" /></th>
                                <th style={styles.th} onClick={() => requestSort('agent_identity')}>Identity <SortIndicator column="agent_identity" /></th>
                                <th style={styles.th} onClick={() => requestSort('full_name')}>Full Name <SortIndicator column="full_name" /></th>
                                <th style={styles.th} onClick={() => requestSort('extension')}>Extension <SortIndicator column="extension" /></th>
                                <th style={styles.th}>Remote Login</th>
                                <th style={styles.th} onClick={() => requestSort('agent_type')}>Agent Type <SortIndicator column="agent_type" /></th>
                                <th style={styles.th}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredAgents.map(agent => (
                                <tr key={agent.agent_id}>
                                    <td style={styles.td}>{agent.agent_id}</td>
                                    <td style={styles.td}>{agent.agent_identity || '-'}</td>
                                    <td style={styles.td}>{agent.full_name}</td>
                                    <td style={styles.td}>{agent.extension}</td>
                                    <td style={styles.td}>{agent.allow_remote_login ? '✅ Yes' : '❌ No'}</td>
                                    <td style={styles.td}>
                                        <span style={{
                                            background: agent.agent_type === 'Normal' ? '#10b98120' : (agent.agent_type === 'Callback' ? '#0084ff20' : '#8b5cf620'),
                                            color: agent.agent_type === 'Normal' ? '#10b981' : (agent.agent_type === 'Callback' ? '#0084ff' : '#8b5cf6'),
                                            padding: '4px 10px',
                                            borderRadius: '20px',
                                            fontSize: '12px'
                                        }}>
                                            {agent.agent_type}
                                        </span>
                                    </td>
                                    <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        <button
                                            style={styles.actionBtn(false)}
                                            onClick={() => setEditModal({
                                                visible: true,
                                                agent: agent,
                                                formData: { ...agent }
                                            })}
                                            title="Edit agent"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            style={styles.actionBtn(false, '#ef4444')}
                                            onClick={() => handleDelete(agent.agent_id, agent.full_name)}
                                            title="Delete agent"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {filteredAgents.length === 0 && (
                                <tr>
                                    <td colSpan="7" style={{ textAlign: 'center', padding: '50px', color: '#475569' }}>
                                        No agents found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* ADD AGENT MODAL */}
                {showAddForm && (
                    <div style={styles.modalOverlay}>
                        <div style={styles.modalBox}>
                            <h3>Add New Agent</h3>
                            <div style={styles.formGrid}>
                                <div>
                                    <label style={styles.label}>Agent ID *</label>
                                    <input style={styles.input} value={newAgent.agent_id} onChange={e => setNewAgent({ ...newAgent, agent_id: e.target.value })} />
                                </div>
                                <div>
                                    <label style={styles.label}>Identity</label>
                                    <input style={styles.input} value={newAgent.agent_identity} onChange={e => setNewAgent({ ...newAgent, agent_identity: e.target.value })} />
                                </div>
                                <div>
                                    <label style={styles.label}>Full Name *</label>
                                    <input style={styles.input} value={newAgent.full_name} onChange={e => setNewAgent({ ...newAgent, full_name: e.target.value })} />
                                </div>
                                <div>
                                    <label style={styles.label}>Extension *</label>
                                    <input style={styles.input} value={newAgent.extension} onChange={e => setNewAgent({ ...newAgent, extension: e.target.value })} />
                                </div>
                                <div>
                                    <label style={styles.label}>SIP Password</label>
                                    <input style={styles.input} type="password" value={newAgent.sip_password} onChange={e => setNewAgent({ ...newAgent, sip_password: e.target.value })} />
                                </div>
                                <div>
                                    <label style={styles.label}>Agent Type</label>
                                    <select style={styles.select} value={newAgent.agent_type} onChange={e => setNewAgent({ ...newAgent, agent_type: e.target.value })}>
                                        <option value="Normal">Normal</option>
                                        <option value="Callback">Callback</option>
                                        <option value="Barge">Barge</option>
                                    </select>
                                </div>
                            </div>
                            <div style={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={newAgent.allow_remote_login === 1}
                                    onChange={e => setNewAgent({ ...newAgent, allow_remote_login: e.target.checked ? 1 : 0 })}
                                />
                                <label>Allow Remote Login</label>
                            </div>
                            <div style={styles.buttonGroup}>
                                <button style={styles.buttonSecondary} onClick={() => setShowAddForm(false)}>Cancel</button>
                                <button style={styles.buttonPrimary} onClick={handleAdd}>Create Agent</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* EDIT AGENT MODAL */}
                {editModal.visible && (
                    <div style={styles.modalOverlay}>
                        <div style={styles.modalBox}>
                            <h3>Edit Agent: {editModal.agent.full_name}</h3>
                            <div style={styles.formGrid}>
                                <div>
                                    <label style={styles.label}>Agent ID</label>
                                    <input style={styles.input} value={editModal.formData.agent_id} disabled />
                                </div>
                                <div>
                                    <label style={styles.label}>Identity</label>
                                    <input style={styles.input} value={editModal.formData.agent_identity || ''} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, agent_identity: e.target.value } })} />
                                </div>
                                <div>
                                    <label style={styles.label}>Full Name *</label>
                                    <input style={styles.input} value={editModal.formData.full_name} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, full_name: e.target.value } })} />
                                </div>
                                <div>
                                    <label style={styles.label}>Extension *</label>
                                    <input style={styles.input} value={editModal.formData.extension} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, extension: e.target.value } })} />
                                </div>
                                <div>
                                    <label style={styles.label}>SIP Password</label>
                                    <input style={styles.input} type="password" value={editModal.formData.sip_password || ''} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, sip_password: e.target.value } })} />
                                </div>
                                <div>
                                    <label style={styles.label}>Agent Type</label>
                                    <select style={styles.select} value={editModal.formData.agent_type} onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, agent_type: e.target.value } })}>
                                        <option value="Normal">Normal</option>
                                        <option value="Callback">Callback</option>
                                        <option value="Barge">Barge</option>
                                    </select>
                                </div>
                            </div>
                            <div style={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={editModal.formData.allow_remote_login === 1}
                                    onChange={e => setEditModal({ ...editModal, formData: { ...editModal.formData, allow_remote_login: e.target.checked ? 1 : 0 } })}
                                />
                                <label>Allow Remote Login</label>
                            </div>
                            <div style={styles.buttonGroup}>
                                <button style={styles.buttonSecondary} onClick={() => setEditModal({ visible: false, agent: null, formData: null })}>Cancel</button>
                                <button style={styles.buttonPrimary} onClick={saveEditChanges}>Save Changes</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AgentsView;
