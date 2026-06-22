import { useState, useEffect } from 'react';

export default function SavedContacts({ agent, theme = 'dark' }) {
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', number: '' });
  const isDark = theme === 'dark';

  useEffect(() => {
    const stored = localStorage.getItem('contacts');
    if (stored) setContacts(JSON.parse(stored));
  }, []);

  const saveContacts = (newContacts) => {
    setContacts(newContacts);
    localStorage.setItem('contacts', JSON.stringify(newContacts));
  };

  const addContact = () => {
    if (!newContact.name || !newContact.number) return;
    saveContacts([...contacts, { id: Date.now(), ...newContact }]);
    setNewContact({ name: '', number: '' });
    setShowAdd(false);
  };

  const deleteContact = (id) => {
    saveContacts(contacts.filter(c => c.id !== id));
  };

  const dialContact = (number) => {
    alert(`Calling ${number}...`);
  };

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.number.includes(search)
  );

  const styles = {
    container: {
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      borderRadius: '12px',
      padding: '20px',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '16px',
    },
    title: {
      fontSize: '16px',
      fontWeight: '600',
      color: isDark ? '#f1f5f9' : '#1e293b',
      margin: 0,
    },
    addBtn: {
      backgroundColor: '#3b82f6',
      color: 'white',
      border: 'none',
      padding: '6px 12px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: '500',
    },
    searchInput: {
      width: '100%',
      padding: '8px 12px',
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      borderRadius: '6px',
      color: isDark ? '#f1f5f9' : '#1e293b',
      marginBottom: '16px',
      fontSize: '12px',
      boxSizing: 'border-box',
    },
    contactList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    },
    contactItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      padding: '12px',
      borderRadius: '8px',
    },
    contactName: {
      fontSize: '13px',
      fontWeight: '500',
      color: isDark ? '#f1f5f9' : '#1e293b',
    },
    contactNumber: {
      fontSize: '11px',
      color: isDark ? '#94a3b8' : '#64748b',
      marginTop: '2px',
      fontFamily: 'monospace',
    },
    contactActions: {
      display: 'flex',
      gap: '6px',
    },
    callContactBtn: {
      backgroundColor: '#10b981',
      color: 'white',
      border: 'none',
      padding: '4px 10px',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '10px',
      fontWeight: '500',
    },
    deleteContactBtn: {
      backgroundColor: '#dc2626',
      color: 'white',
      border: 'none',
      padding: '4px 10px',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '10px',
      fontWeight: '500',
    },
    emptyState: {
      textAlign: 'center',
      padding: '40px 20px',
      color: isDark ? '#64748b' : '#94a3b8',
    },
    emptyIcon: {
      fontSize: '48px',
      marginBottom: '12px',
    },
    emptyBtn: {
      backgroundColor: '#3b82f6',
      color: 'white',
      border: 'none',
      padding: '8px 16px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '12px',
      marginTop: '12px',
    },
    modalOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
    },
    modal: {
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      padding: '20px',
      borderRadius: '12px',
      width: '360px',
    },
    modalTitle: {
      fontSize: '16px',
      fontWeight: '600',
      color: isDark ? '#f1f5f9' : '#1e293b',
      marginBottom: '16px',
    },
    modalInput: {
      width: '100%',
      padding: '10px',
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      borderRadius: '6px',
      color: isDark ? '#f1f5f9' : '#1e293b',
      marginBottom: '12px',
      fontSize: '12px',
      boxSizing: 'border-box',
    },
    modalButtons: {
      display: 'flex',
      gap: '10px',
    },
    saveBtn: {
      flex: 1,
      backgroundColor: '#10b981',
      color: 'white',
      border: 'none',
      padding: '8px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '500',
    },
    cancelBtn: {
      flex: 1,
      backgroundColor: isDark ? '#334155' : '#e2e8f0',
      color: isDark ? '#e2e8f0' : '#475569',
      border: 'none',
      padding: '8px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '500',
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Saved Contacts</h2>
        <button onClick={() => setShowAdd(true)} style={styles.addBtn}>+ Add Contact</button>
      </div>
      
      <input
        type="text"
        placeholder="Search contacts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={styles.searchInput}
      />
      
      {contacts.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📇</div>
          <p>No contacts saved yet</p>
          <button onClick={() => setShowAdd(true)} style={styles.emptyBtn}>Add your first contact</button>
        </div>
      ) : (
        <div style={styles.contactList}>
          {filteredContacts.map(contact => (
            <div key={contact.id} style={styles.contactItem}>
              <div>
                <div style={styles.contactName}>{contact.name}</div>
                <div style={styles.contactNumber}>{contact.number}</div>
              </div>
              <div style={styles.contactActions}>
                <button onClick={() => dialContact(contact.number)} style={styles.callContactBtn}>📞 Call</button>
                <button onClick={() => deleteContact(contact.id)} style={styles.deleteContactBtn}>🗑️ Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>Add New Contact</h3>
            <input
              type="text"
              placeholder="Full Name"
              value={newContact.name}
              onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
              style={styles.modalInput}
            />
            <input
              type="text"
              placeholder="Phone Number"
              value={newContact.number}
              onChange={(e) => setNewContact({ ...newContact, number: e.target.value })}
              style={styles.modalInput}
            />
            <div style={styles.modalButtons}>
              <button onClick={addContact} style={styles.saveBtn}>Save</button>
              <button onClick={() => setShowAdd(false)} style={styles.cancelBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
