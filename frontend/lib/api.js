const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function getAccessToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('accessToken');
}

async function request(path, { method = 'GET', body, params, auth = false } = {}) {
  const url = new URL(path, API_URL);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
  }

  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data.error || data.errors?.[0]?.msg || 'Request failed';
    throw new Error(message);
  }

  return data;
}

export const api = {
  // Auth
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  refresh: (refreshToken) => request('/auth/refresh', { method: 'POST', body: { refreshToken } }),

  // Profiles
  getMyProfile: () => request('/profiles/me', { auth: true }),
  updateFreelancerProfile: (payload) =>
    request('/profiles/freelancer', { method: 'PATCH', body: payload, auth: true }),

  // Jobs
  listJobs: (params) => request('/jobs', { params }),
  getJob: (id) => request(`/jobs/${id}`),
  postJob: (payload) => request('/jobs', { method: 'POST', body: payload, auth: true }),
  updateJob: (id, payload) => request(`/jobs/${id}`, { method: 'PATCH', body: payload, auth: true }),
  cancelJob: (id) => request(`/jobs/${id}/cancel`, { method: 'POST', auth: true }),

  // Proposals
  submitProposal: (jobId, payload) =>
    request(`/jobs/${jobId}/proposals`, { method: 'POST', body: payload, auth: true }),
  listProposalsForJob: (jobId) => request(`/jobs/${jobId}/proposals`, { auth: true }),
  myProposals: () => request('/proposals/mine', { auth: true }),
  hireProposal: (id) => request(`/proposals/${id}/hire`, { method: 'POST', auth: true }),
  withdrawProposal: (id) => request(`/proposals/${id}/withdraw`, { method: 'POST', auth: true }),

  // Payments
  fundEscrow: (paymentId, payload) =>
    request(`/payments/${paymentId}/fund`, { method: 'POST', body: payload, auth: true }),
  releasePayment: (paymentId) => request(`/payments/${paymentId}/release`, { method: 'POST', auth: true }),
  disputePayment: (paymentId, reason) =>
    request(`/payments/${paymentId}/dispute`, { method: 'POST', body: { reason }, auth: true }),

  // Withdrawals
  requestWithdrawal: (payload) => request('/withdrawals', { method: 'POST', body: payload, auth: true }),
  myWithdrawals: () => request('/withdrawals/mine', { auth: true }),
};
