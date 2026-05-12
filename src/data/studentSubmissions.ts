import type { StudentSubmission } from "../domain/feedback";

const STORAGE_KEY = "xdu-food-student-submissions-v1";
const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "";

export function loadStudentSubmissions(): StudentSubmission[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveStudentSubmissions(submissions: StudentSubmission[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(submissions));
}

export async function loadServerSubmissions(): Promise<StudentSubmission[]> {
  const response = await fetch(`${API_BASE}/api/submissions`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to load submissions: ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.submissions) ? payload.submissions : [];
}

export async function loadAdminSubmissions(token: string): Promise<StudentSubmission[]> {
  const response = await fetch(`${API_BASE}/api/admin/submissions`, {
    headers: {
      Accept: "application/json",
      "X-Admin-Token": token,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to load admin submissions: ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.submissions) ? payload.submissions : [];
}

export async function updateSubmissionStatus(id: string, status: string, token: string): Promise<StudentSubmission[]> {
  const response = await fetch(`${API_BASE}/api/admin/submissions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": token,
      Accept: "application/json",
    },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update submission: ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.submissions) ? payload.submissions : [];
}

export async function submitStudentSubmission(submission: StudentSubmission): Promise<StudentSubmission> {
  const response = await fetch(`${API_BASE}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(submission),
  });
  if (!response.ok) {
    throw new Error(`Failed to submit feedback: ${response.status}`);
  }
  const payload = await response.json();
  return payload.submission ?? submission;
}

export function makeSubmissionId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `student-${Date.now().toString(36)}-${random}`;
}

export function exportSubmissions(submissions: StudentSubmission[]) {
  const blob = new Blob([JSON.stringify(submissions, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `xdu-food-submissions-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
