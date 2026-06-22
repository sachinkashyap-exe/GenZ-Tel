import axios from 'axios';

// Use RELATIVE URL - React proxy will forward to backend
const API_BASE = '/api';

console.log('🔧 API Base URL:', API_BASE);
// console.log('📍 Frontend URL:', window.location.href);

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000
});

// Add token to requests
api.interceptors.request.use(config => {
  // 🚫 Prevent login calls when already authenticated
  if (config.url === '/auth/login' && localStorage.getItem('token')) {
    console.warn('Blocked /auth/login call – already logged in');
    return Promise.reject({ message: 'Already logged in' });
  }

  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  console.log(`📤 ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});


// Response interceptor
api.interceptors.response.use(
  response => {
    console.log(`📥 Response: ${response.status}`);
    return response;
  },
  error => {
    console.error('❌ API Error:', error.message);
    if (error.response?.status === 401) {
      localStorage.clear();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
