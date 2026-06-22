import axios from 'axios';

const API_BASE_URL = 'http://192.168.1.248:8000';

// ========== Queue / Campaign Services ==========
export const fetchCampaigns = () => axios.get(`${API_BASE_URL}/admin/queues/`).then(res => res.data);
export const createCampaign = (data) => axios.post(`${API_BASE_URL}/admin/queues/`, data).then(res => res.data);
export const updateCampaign = (id, data) => axios.put(`${API_BASE_URL}/admin/queues/${id}`, data).then(res => res.data);
export const deleteCampaign = (id) => axios.delete(`${API_BASE_URL}/admin/queues/${id}`).then(res => res.data);
export const applyFreeSWITCHConfig = () => axios.post(`${API_BASE_URL}/admin/apply/freeswitch`).then(res => res.data);

// ========== Legacy Dashboard Data (if any component still uses it) ==========
export const fetchDashboardData = async () => {
    try {
        const [stats, charts, agents, calls] = await Promise.all([
            axios.get(`${API_BASE_URL}/admin/stats`),
            axios.get(`${API_BASE_URL}/admin/chart-data`),
            axios.get(`${API_BASE_URL}/admin/top-agents`),
            axios.get(`${API_BASE_URL}/admin/recent-calls`)
        ]);
        return {
            stats: stats.data,
            charts: charts.data,
            topAgents: agents.data,
            recentCalls: calls.data
        };
    } catch (error) {
        console.error("Error fetching dashboard data:", error);
        throw error;
    }
};

// ========== New Dashboard Services (matching actual endpoints used by DashboardView) ==========
export const fetchDashboardStats = () =>
    axios.get(`${API_BASE_URL}/api/dashboard/stats`).then(res => res.data);

export const fetchDashboardChart = async (days = 7) => {
    const res = await axios.get(`${API_BASE_URL}/api/dashboard/chart?days=${days}`);
    // Transform data to match the format expected by the chart component
    const { dates, total, answered, missed } = res.data;
    return dates.map((date, i) => ({
        name: date,
        total: total[i],
        answered: answered[i],
        missed: missed[i]
    }));
};

export const fetchQueueStatus = () =>
    axios.get(`${API_BASE_URL}/api/queue/status`).then(res => res.data);

export const fetchRecentCalls = (limit = 5) =>
    axios.get(`${API_BASE_URL}/api/calls/recent?limit=${limit}`).then(res => res.data);



// ========== Agent Management Services ==========
export const fetchAgents = () =>
    axios.get(`${API_BASE_URL}/admin/agents/`).then(res => res.data);

export const createAgent = (data) =>
    axios.post(`${API_BASE_URL}/admin/agents/`, data).then(res => res.data);

export const updateAgent = (agentId, data) =>
    axios.put(`${API_BASE_URL}/admin/agents/${agentId}`, data).then(res => res.data);

export const deleteAgent = (agentId) =>
    axios.delete(`${API_BASE_URL}/admin/agents/${agentId}`).then(res => res.data);

// Assign multiple campaign IDs to an agent (overwrites existing assignments)
export const assignCampaignsToAgent = (agentId, campaignIds) =>
    axios.put(`${API_BASE_URL}/admin/agents/${agentId}/campaigns`, { campaign_ids: campaignIds })
        .then(res => res.data);

// Fetch campaigns assigned to an agent
export const fetchAgentCampaigns = (agentId) =>
    axios.get(`${API_BASE_URL}/admin/agents/${agentId}/campaigns`).then(res => res.data);


