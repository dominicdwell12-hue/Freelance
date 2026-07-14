'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import styles from './jobs.module.css';

const CATEGORIES = [
  { id: '', label: 'All categories' },
  { id: '1', label: 'Web Development' },
  { id: '2', label: 'Graphic Design' },
  { id: '3', label: 'Video Editing' },
  { id: '4', label: 'Writing' },
];

function formatBudget(job) {
  if (!job.budget_min && !job.budget_max) return '—';
  if (job.budget_min && job.budget_max) return `$${job.budget_min}–${job.budget_max}`;
  return `$${job.budget_min || job.budget_max}`;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    const params = {};
    if (category) params.category_id = category;
    if (q) params.q = q;

    api
      .listJobs(params)
      .then((data) => {
        if (!cancelled) setJobs(data.jobs);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category, q]);

  return (
    <div className={`page ${styles.wrap}`}>
      <div className={styles.headRow}>
        <h1>Open jobs</h1>
        <a href="/jobs/new" className={styles.postCta}>Post a job</a>
      </div>

      <div className={styles.filters}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search jobs…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search jobs"
        />
      </div>

      {error && <p>{error}</p>}

      {loading ? (
        <p>Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <div className={styles.empty}>
          <p>No open jobs match those filters yet. Try widening your search, or check back soon.</p>
        </div>
      ) : (
        <div className={styles.ledger}>
          {jobs.map((job) => (
            <a key={job.id} href={`/jobs/${job.id}`} className={`${styles.row} fade-in-row`}>
              <div className={styles.rowMain}>
                <p className={styles.title}>
                  {job.is_featured && <span className={styles.featuredDot} aria-label="Featured" />}
                  {job.title}
                </p>
                <p className={styles.meta}>{job.proposal_count} proposal{job.proposal_count === '1' ? '' : 's'} so far</p>
              </div>
              <div className={styles.category}>
                {CATEGORIES.find((c) => c.id === String(job.category_id))?.label || ''}
              </div>
              <div className={styles.budget}>{formatBudget(job)}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
