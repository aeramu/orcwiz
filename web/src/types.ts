export type Task = {
  id: number;
  title: string;
  description: string | null;
  status: string;
  project_path: string;
  absolute_project_path: string;
  session_id: string | null;
  parent_id: number | null;
  assigned_agent: string | null;
  created_at: string;
};

export type Column = {
  id: string;
  title: string;
  color: string;
  bg: string;
  border: string;
  badgeClass: string;
};

export type OrcwizConfig = {
  opencode_server_url: string | null;
  opencode_auth_header: string | null;
};
