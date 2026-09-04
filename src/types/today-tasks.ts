export type TodayTaskItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
};

export type TodayTaskGroup = {
  key: "overdue" | "payments" | "email" | "addresses" | "documents";
  label: string;
  description: string;
  count: number;
  items: TodayTaskItem[];
};

export type TodayTasksResponse = {
  total: number;
  groups: TodayTaskGroup[];
};
