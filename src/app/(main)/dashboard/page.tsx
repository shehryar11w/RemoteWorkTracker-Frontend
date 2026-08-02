'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import styles from './dashboard-page.module.css';
import { useAuth } from '@/hooks';
import { useDashboardSummary } from '@/services/dashboard/useDashboardSummary';
import { useTelemetryDaily } from '@/services/telemetry/useTelemetryDaily';
import { useUsersList } from '@/services/users/useUsers';
import { useProjectsList } from '@/services/projects/useProjects';
import { useGoalsList } from '@/services/goals/useGoals';
import { usePayrollList } from '@/services/payroll/usePayroll';
import { useAnalyticsOverview } from '@/services/analytics/useAnalytics';
import {
  useAiPerformanceRanking,
  useProductivityReport,
  useTeamPerformanceReport,
} from '@/services/analytics/useAnalytics';
import { useDepartmentsList } from '@/services/departments/useDepartments';
import { useWellnessListAll } from '@/services/wellness/useWellness';
import { telemetryService } from '@/services/telemetry/telemetry.service';
import { tasksService } from '@/services/tasks/tasks.service';
import { projectsService } from '@/services/projects/projects.service';
import { useRolesList } from '@/services/roles/useRoles';
import type { TelemetryDailyRow, TelemetryDetailResponse } from '@/types/telemetry';
import type { User, Goal, Project, PayrollRecord, Department, Role, Task, TaskListResponse } from '@/types';
import type { AiPerformanceRankingRow, TeamPerformanceRow } from '@/types';
import { formatPkrCompact } from '@/lib/formatCurrency';
import LoadingIndicator from '@/components/LoadingIndicator';
import {
  appColorForLabel,
  averageActiveHoursByDay,
  currentMonthYMD,
  departmentName,
  deriveInsightsFromFacts,
  filterUsersByOrg,
  formatDurationSeconds,
  goalsForOrg,
  getUserId,
  initialsFromName,
  mergeUserTelemetryToday,
  miniBarsFromSeries,
  moodSummary,
  aggregateDailyRowsByUser,
  periodDatesUtcMonthToDate,
  projectProgressFromTasks,
  projectStatusLabel,
  rowsForDay,
  segmentBarFullDayUtc,
  sumPayrollMonth,
  utcMonthToDateDayCount,
  toneGradientForId,
  unwrapApiList,
  unwrapTasksListPayload,
  unwrapWellnessEnvelope,
  utcTodayYMD,
  monthStartDateYMD,
} from './dashboard-helpers';

function MiniBars({ bars }: { bars: number[] }) {
  return (
    <div className={styles.pageMiniChart} aria-hidden="true">
      {bars.map((height, index) => (
        <span key={index} style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

function dashRankingBandClass(band: string): string {
  if (band === 'top') return styles.dashRankBandTop;
  if (band === 'low') return styles.dashRankBandLow;
  return styles.dashRankBandMid;
}

function rankingPillars(r: AiPerformanceRankingRow): Array<{ label: string; value: number }> {
  return [
    { label: 'Productivity', value: r.productivity },
    { label: 'Task completion', value: r.task_completion },
    { label: 'Attendance', value: r.attendance },
    { label: 'Efficiency', value: r.efficiency },
    { label: 'Collaboration', value: r.collaboration },
  ];
}

function CardSection({
  title,
  subtitle,
  action,
  actionHref,
  children,
  icon,
  iconTone,
  className,
}: {
  title: string;
  subtitle: string;
  action?: string;
  actionHref?: string;
  children: ReactNode;
  icon: ReactNode;
  iconTone: string;
  className?: string;
}) {
  return (
    <section className={`${styles.card} ${className ?? ''}`.trim()}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeading}>
          <div className={styles.iconBadge} style={{ background: iconTone }}>
            {icon}
          </div>
          <div>
            <h2 className={styles.cardTitle}>{title}</h2>
            <p className={styles.cardSubtitle}>{subtitle}</p>
          </div>
        </div>
        {action && actionHref ? (
          <Link href={actionHref} className={styles.cardAction}>
            {action}
          </Link>
        ) : null}
      </div>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

function StatTile({
  title,
  value,
  change,
  toneStart,
  toneEnd,
  icon,
  bars,
  trend = 'neutral',
}: {
  title: string;
  value: string;
  change: string;
  toneStart: string;
  toneEnd: string;
  icon: string;
  bars?: number[];
  trend?: 'up' | 'down' | 'neutral';
}) {
  const arrow = trend === 'down' ? '▼' : trend === 'up' ? '▲' : '•';
  return (
    <article
      className={styles.statCard}
      style={{ background: `linear-gradient(135deg, ${toneStart}, ${toneEnd})` }}
    >
      <div className={styles.statTop}>
        <div className={styles.statLabelRow}>
          <span aria-hidden="true">{icon}</span>
          <span>{title}</span>
        </div>
        {bars && bars.length > 0 ? <MiniBars bars={bars} /> : null}
      </div>
      <p className={styles.statValue}>{value}</p>
      <div className={styles.statChange}>
        <span aria-hidden="true">{arrow}</span>
        <span>{change}</span>
      </div>
    </article>
  );
}

export default function DashboardPage() {
  const { organizationId } = useAuth();
  const todayYmd = utcTodayYMD();
  const [expandedRankingId, setExpandedRankingId] = useState<string | null>(null);

  const monthYm = useMemo(() => currentMonthYMD(), []);
  const periodMonth = useMemo(() => periodDatesUtcMonthToDate(), [todayYmd]);
  const summaryMonthDays = useMemo(() => utcMonthToDateDayCount(), [todayYmd]);

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryIsError,
    error: summaryError,
  } = useDashboardSummary({
    organizationId,
    days: summaryMonthDays,
    enabled: !!organizationId,
  });

  const { data: dailyRows = [], isLoading: dailyLoading } = useTelemetryDaily({
    organizationId,
    startDate: periodMonth.startDate,
    endDate: periodMonth.endDate,
    enabled: !!organizationId,
  });

  const { data: usersResponse } = useUsersList();
  const { data: projectsResponse } = useProjectsList(1, 80, organizationId ?? undefined);
  const { data: goalsResponse, isError: goalsListError } = useGoalsList(
    { limit: 100, organizationId: organizationId ?? undefined },
    { enabled: !!organizationId }
  );
  const { data: payrollResponse } = usePayrollList({ month: monthYm, limit: 100 });
  const { data: departmentsResponse } = useDepartmentsList();
  const { data: rolesResponse } = useRolesList({ enabled: !!organizationId });

  const { data: appsByDayRes, isError: appsByDayError } = useQuery({
    queryKey: ['telemetry', 'apps-by-day', organizationId, todayYmd],
    enabled: Boolean(organizationId),
    staleTime: 60_000,
    queryFn: () =>
      telemetryService.agentAppsByDay({
        organizationId: organizationId!,
        day: todayYmd,
      }),
  });

  const { data: deskLatestRes } = useQuery({
    queryKey: ['telemetry', 'desk-latest', organizationId, todayYmd],
    enabled: Boolean(organizationId),
    staleTime: 45_000,
    queryFn: () =>
      telemetryService.agentDeskLatest({
        organizationId: organizationId!,
        day: todayYmd,
      }),
  });

  const wellnessFilters = useMemo(
    () => ({
      organizationId: organizationId || undefined,
      startDate: monthStartDateYMD(),
      endDate: utcTodayYMD(),
      limit: 100,
      page: 1,
    }),
    [organizationId]
  );
  const { data: wellnessEnvelope } = useWellnessListAll(wellnessFilters);

  const overviewParams = useMemo(
    () => ({
      organizationId: organizationId || undefined,
      days: Math.min(Math.max(summaryMonthDays, 1), 90),
    }),
    [organizationId, summaryMonthDays]
  );
  const { data: analyticsOverview } = useAnalyticsOverview(overviewParams);

  const perfFilters = useMemo(
    () => ({ startDate: periodMonth.startDate, endDate: periodMonth.endDate }),
    [periodMonth.endDate, periodMonth.startDate]
  );
  const { data: teamPerf } = useTeamPerformanceReport(perfFilters);
  const { data: productivityReport } = useProductivityReport(perfFilters);

  const aiRankingFilters = useMemo(
    () => ({
      startDate: periodMonth.startDate,
      endDate: periodMonth.endDate,
      organizationId: organizationId ?? undefined,
    }),
    [periodMonth.endDate, periodMonth.startDate, organizationId]
  );
  const {
    data: aiRankingPayload,
    isLoading: aiRankingLoading,
    isError: aiRankingIsError,
    error: aiRankingError,
  } = useAiPerformanceRanking(aiRankingFilters, Boolean(organizationId));

  /** Same length as MTD, immediately before the current month (fairer than full prior calendar month vs partial MTD). */
  const prevRange = useMemo(() => {
    const n = Math.max(1, summaryMonthDays);
    const monthStart = new Date(`${periodMonth.startDate}T12:00:00.000Z`);
    const endPrev = new Date(monthStart.getTime() - 86400000);
    const startPrev = new Date(endPrev.getTime() - (n - 1) * 86400000);
    return {
      startDate: startPrev.toISOString().slice(0, 10),
      endDate: endPrev.toISOString().slice(0, 10),
    };
  }, [periodMonth.startDate, summaryMonthDays]);
  const { data: teamPerfPrev } = useTeamPerformanceReport(prevRange);

  const orgUsers = useMemo(() => {
    const all = unwrapApiList<User>(usersResponse as { data?: unknown });
    if (!organizationId) return [];
    return filterUsersByOrg(all, organizationId);
  }, [organizationId, usersResponse]);

  const departmentById = useMemo(() => {
    const rows = unwrapApiList<Department>(departmentsResponse as { data?: unknown });
    const m = new Map<string, string>();
    for (const d of rows) {
      const id = d.departmentId || (d as { department_id?: string }).department_id;
      if (id) m.set(id, d.name || id);
    }
    return m;
  }, [departmentsResponse]);

  const roleNameById = useMemo(() => {
    const rows = unwrapApiList<Role>(rolesResponse as { data?: unknown });
    const m = new Map<string, string>();
    for (const r of rows) {
      const id = r.role_id || (r as { roleId?: string }).roleId;
      if (id) m.set(id, r.name);
    }
    return m;
  }, [rolesResponse]);

  const latestAppByUserId = useMemo(() => {
    const out = new Map<string, string>();
    const rows = deskLatestRes?.data?.data;
    if (!Array.isArray(rows)) return out;
    for (const row of rows) {
      const label = row.appLabel?.trim() || row.windowTitle?.trim() || '';
      out.set(row.userId, label || '—');
    }
    return out;
  }, [deskLatestRes]);

  const projects = useMemo(
    () => unwrapApiList<Project>(projectsResponse as { data?: unknown }),
    [projectsResponse]
  );

  const visibleProjectIds = useMemo(() => projects.slice(0, 8).map((p) => p.project_id), [projects]);

  const taskQueries = useQueries({
    queries: visibleProjectIds.map((pid) => ({
      queryKey: ['tasks', 'list', 'dash', organizationId, pid],
      enabled: Boolean(organizationId && pid),
      staleTime: 60_000,
      queryFn: () => tasksService.list({ projectId: pid, limit: 200 }),
    })),
  });

  const memberQueries = useQueries({
    queries: visibleProjectIds.map((pid) => ({
      queryKey: ['projects', 'members', organizationId, pid],
      enabled: Boolean(organizationId && pid),
      staleTime: 120_000,
      queryFn: () => projectsService.listMembers(pid),
    })),
  });
  const goalsRaw = useMemo(
    () => unwrapApiList<Goal>(goalsResponse as { data?: unknown }),
    [goalsResponse]
  );
  const payrollRecords = useMemo(
    () => unwrapApiList<PayrollRecord>(payrollResponse as { data?: unknown }),
    [payrollResponse]
  );
  const wellnessLogs = useMemo(
    () => unwrapWellnessEnvelope(wellnessEnvelope as { data?: unknown }),
    [wellnessEnvelope]
  );

  const orgUserIds = useMemo(() => new Set(orgUsers.map((u) => getUserId(u)).filter(Boolean)), [orgUsers]);
  const goals = useMemo(() => goalsForOrg(goalsRaw, orgUserIds), [goalsRaw, orgUserIds]);

  const monthDailyRows = useMemo(
    () => dailyRows.filter((r) => r.day >= periodMonth.startDate && r.day <= periodMonth.endDate),
    [dailyRows, periodMonth]
  );
  const monthByUser = useMemo(() => aggregateDailyRowsByUser(monthDailyRows), [monthDailyRows]);

  const teamRows = teamPerf?.data ?? [];
  const teamRowsPrev = teamPerfPrev?.data ?? [];
  const productivityRows = productivityReport?.data ?? [];

  const perfByUserId = useMemo(() => {
    const m = new Map<string, TeamPerformanceRow>();
    for (const r of teamRows) m.set(r.userId, r);
    return m;
  }, [teamRows]);

  const avgCompletion =
    teamRows.length > 0
      ? Math.round(teamRows.reduce((s, r) => s + r.completionRate, 0) / teamRows.length)
      : 0;
  const avgCompletionPrev =
    teamRowsPrev.length > 0
      ? Math.round(teamRowsPrev.reduce((s, r) => s + r.completionRate, 0) / teamRowsPrev.length)
      : 0;
  const completionDelta = avgCompletion - avgCompletionPrev;

  const avgProdScore =
    productivityRows.length > 0
      ? Math.round(productivityRows.reduce((s, r) => s + r.productivityScore, 0) / productivityRows.length)
      : avgCompletion;

  const todayRows = useMemo(() => rowsForDay(dailyRows, todayYmd), [dailyRows, todayYmd]);
  const membersWithDataMonth = useMemo(() => {
    const ids = new Set<string>();
    for (const r of monthDailyRows) {
      if (r.activeSeconds > 0 || r.idleSeconds > 0) ids.add(r.userId);
    }
    return ids.size;
  }, [monthDailyRows]);
  const payrollTotals = useMemo(() => sumPayrollMonth(payrollRecords), [payrollRecords]);
  const mood = useMemo(() => moodSummary(wellnessLogs), [wellnessLogs]);

  const timelineUserIds = useMemo(() => {
    const fromToday = [...todayRows]
      .sort((a, b) => b.activeSeconds - a.activeSeconds)
      .slice(0, 4)
      .map((r) => r.userId);
    if (fromToday.length > 0) return fromToday;
    const totals = new Map<string, number>();
    for (const r of monthDailyRows) {
      totals.set(r.userId, (totals.get(r.userId) || 0) + r.activeSeconds);
    }
    const fromMonth = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([uid]) => uid);
    if (fromMonth.length > 0) return fromMonth;
    return orgUsers
      .slice(0, 4)
      .map((u) => getUserId(u))
      .filter(Boolean);
  }, [todayRows, monthDailyRows, orgUsers]);

  const timelineQueries = useQueries({
    queries: timelineUserIds.map((uid) => ({
      queryKey: ['telemetry', 'detail', 'dash', organizationId, uid, todayYmd],
      enabled: Boolean(organizationId && uid),
      staleTime: 60_000,
      queryFn: async (): Promise<TelemetryDetailResponse> => {
        const res = await telemetryService.agentActivityDetail({
          organizationId: organizationId || undefined,
          userId: uid,
          day: todayYmd,
          limit: 400,
        });
        const body = res as { data?: TelemetryDetailResponse };
        return (
          body.data ?? {
            userId: uid,
            day: todayYmd,
            data: [],
            meta: { page: 1, limit: 400, totalRecords: 0, totalPages: 1 },
          }
        );
      },
    })),
  });

  const applicationBars = useMemo(() => {
    const rows = appsByDayRes?.data?.data;
    if (!Array.isArray(rows) || !rows.length) return [];
    const total = rows.reduce((s, x) => s + (x.totalSeconds || 0), 0) || 1;
    return rows.slice(0, 6).map((x) => ({
      name: x.appLabel,
      time: formatDurationSeconds(x.totalSeconds || 0),
      percent: Math.round(((x.totalSeconds || 0) / total) * 100),
      tone: appColorForLabel(x.appLabel),
    }));
  }, [appsByDayRes]);

  const productivityByDay = useMemo(
    () => averageActiveHoursByDay(dailyRows, periodMonth.startDate, periodMonth.endDate),
    [dailyRows, periodMonth.endDate, periodMonth.startDate]
  );

  const chartBars = useMemo(() => {
    const hrs = productivityByDay.map((p) => p.hours);
    if (!hrs.length || hrs.every((h) => !h)) return [];
    return miniBarsFromSeries(hrs);
  }, [productivityByDay]);

  const employees = useMemo(() => {
    return orgUsers.slice(0, 12).map((u) => {
      const id = getUserId(u);
      const row = monthByUser.get(id);
      const perf = perfByUserId.get(id);
      const deptId = u.department_id || u.departmentId;
      const roleId = u.role_id || u.roleId;
      const roleLabel = roleId ? roleNameById.get(roleId) : undefined;
      return mergeUserTelemetryToday(u, row, perf, departmentName(deptId, departmentById), {
        roleLabel,
        currentApp: latestAppByUserId.get(id),
      });
    });
  }, [departmentById, latestAppByUserId, monthByUser, orgUsers, perfByUserId, roleNameById]);

  const timelineEmployees = useMemo(() => {
    return timelineUserIds.map((uid, idx) => {
      const q = timelineQueries[idx];
      const nameRow = todayRows.find((r) => r.userId === uid);
      const label = nameRow?.name || orgUsers.find((u) => getUserId(u) === uid)?.name || uid;
      const initials = initialsFromName(label);
      const segments =
        q?.data?.data?.map((seg) => {
          const bar = segmentBarFullDayUtc(seg.createdAt, seg.durationSeconds || 0, todayYmd);
          if (!bar) return null;
          return { left: bar.left, width: bar.width, color: bar.color };
        }) ?? [];
      const flat = segments.filter(Boolean) as { left: number; width: number; color: string }[];
      return {
        name: label,
        initials,
        device: 'Agent',
        tone: toneGradientForId(uid),
        segments: flat.length ? flat : [{ left: 0, width: 100, color: '#64748b' }],
      };
    });
  }, [timelineQueries, timelineUserIds, todayRows, orgUsers]);

  const statCards = useMemo(() => {
    const members = summary?.people.members ?? orgUsers.length;
    const withData = summary?.people.withAgentDataInPeriod ?? 0;
    return [
      {
        title: 'Total Employees',
        value: String(members),
        change: `${withData} with telemetry this month (MTD)`,
        toneStart: '#2458f5',
        toneEnd: '#1ea7ff',
        icon: '●',
        bars: chartBars,
        trend: 'neutral' as const,
      },
      {
        title: 'Active members (MTD)',
        value: String(membersWithDataMonth),
        change:
          members > 0 ? `${Math.round((membersWithDataMonth / members) * 100)}% of team` : 'No members',
        toneStart: '#0ea5c7',
        toneEnd: '#14b8a6',
        icon: '◌',
        trend: 'neutral' as const,
      },
      {
        title: 'Avg task completion',
        value: `${avgCompletion}%`,
        change: `${completionDelta >= 0 ? '+' : ''}${completionDelta}% vs prior period`,
        toneStart: '#10b981',
        toneEnd: '#22c55e',
        icon: '▲',
        bars: chartBars,
        trend: (completionDelta < 0 ? 'down' : completionDelta > 0 ? 'up' : 'neutral') as
          | 'up'
          | 'down'
          | 'neutral',
      },
      {
        title: 'Active projects',
        value: String(summary?.work.projects ?? projects.length),
        change: `${summary?.work.tasks.openOrActive ?? 0} open tasks`,
        toneStart: '#7c3aed',
        toneEnd: '#a855f7',
        icon: '◧',
        trend: 'neutral' as const,
      },
      {
        title: 'Payroll (month)',
        value: formatPkrCompact(payrollTotals.total),
        change: `OT ${formatPkrCompact(payrollTotals.overtime)}`,
        toneStart: '#f59e0b',
        toneEnd: '#fb923c',
        icon: '$',
        trend: 'neutral' as const,
      },
      {
        title: 'Wellness index',
        value: String(mood.score),
        change: `${mood.happy} positive / ${mood.stressed} strained`,
        toneStart: '#f43f5e',
        toneEnd: '#fb7185',
        icon: '♥',
        trend: 'neutral' as const,
      },
    ];
  }, [
    avgCompletion,
    chartBars,
    completionDelta,
    membersWithDataMonth,
    mood.happy,
    mood.score,
    mood.stressed,
    orgUsers.length,
    payrollTotals.overtime,
    payrollTotals.total,
    projects.length,
    summary,
  ]);

  const insights = useMemo(() => {
    const ai = analyticsOverview?.aiInsights;
    if (ai?.available && ai.data && typeof ai.data === 'object') {
      const raw = Object.entries(ai.data as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string')
        .slice(0, 5)
        .map(([k, v], i) => ({
          title: k.replace(/_/g, ' '),
          description: String(v),
          tone: ['#2563eb', '#10b981', '#fb7185', '#f59e0b', '#7c3aed'][i % 5]!,
          bg: ['rgba(37, 99, 235, 0.1)', 'rgba(16, 185, 129, 0.1)', 'rgba(244, 63, 94, 0.1)', 'rgba(245, 158, 11, 0.1)', 'rgba(124, 58, 237, 0.1)'][i % 5]!,
        }));
      if (raw.length) return raw;
    }
    return deriveInsightsFromFacts(
      avgProdScore,
      summary?.telemetry.coverageRatio ?? 0,
      summary?.unreadNotifications
    );
  }, [analyticsOverview?.aiInsights, analyticsOverview?.facts, avgProdScore, summary]);

  const meDesk = summary?.me;

  const donutActivePct = useMemo(() => {
    if (meDesk && meDesk.activeSeconds + meDesk.idleSeconds > 0) {
      return Math.round((meDesk.activeSeconds / (meDesk.activeSeconds + meDesk.idleSeconds)) * 100);
    }
    const a = summary?.telemetry.totalActiveSeconds ?? 0;
    const i = summary?.telemetry.totalIdleSeconds ?? 0;
    if (a + i <= 0) return 0;
    return Math.round((a / (a + i)) * 100);
  }, [meDesk, summary?.telemetry.totalActiveSeconds, summary?.telemetry.totalIdleSeconds]);

  const loading = summaryLoading || dailyLoading;

  if (!organizationId) {
    return (
      <section className={styles.page}>
        <p className={styles.subtitle}>Sign in as an organization to load the dashboard.</p>
      </section>
    );
  }

  const summaryErrMsg = summaryIsError && summaryError instanceof Error ? summaryError.message : '';

  const goalProgressAvg =
    goals.length > 0 ? Math.round(goals.reduce((s, g) => s + (g.progress || 0), 0) / goals.length) : 0;

  return (
    <section className={styles.page}>
      <div className={styles.shell}>
        {summaryIsError ? (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(220, 38, 38, 0.12)',
              border: '1px solid rgba(220, 38, 38, 0.35)',
              color: 'var(--dash-stat-text, inherit)',
              fontSize: 14,
            }}
          >
            <strong>Dashboard summary could not be loaded.</strong> {summaryErrMsg || 'Request failed.'} Set{' '}
            <code style={{ fontSize: 13 }}>NEXT_PUBLIC_API_URL</code> to your Express API base (for example{' '}
            <code style={{ fontSize: 13 }}>http://localhost:5000</code>), not the Vercel frontend URL. Restart{' '}
            <code style={{ fontSize: 13 }}>next dev</code> after changing env. Other sections below may still show
            partial data.
          </div>
        ) : null}
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>Telemetry dashboard</p>
            <h1 className={styles.title}>Remote Work Tracker</h1>
            <p className={styles.subtitle}>
              Live operational metrics from the portal API: telemetry, tasks, goals, payroll, wellness, and analytics.
            </p>
            {loading ? <p className={styles.smallRow}>Refreshing data…</p> : null}
          </div>
          <div className={styles.heroMeta}>
            <div className={styles.metaCard}>
              <div>
                <p className={styles.metaLabel}>Agent coverage</p>
                <p className={styles.metaValue}>
                  {summary?.people.withAgentDataInPeriod ?? 0} / {summary?.people.members ?? '—'} with data
                </p>
              </div>
              <div className={styles.metaTone}>
                {Math.round((summary?.telemetry.coverageRatio ?? 0) * 100)}% period
              </div>
            </div>
            <div className={styles.metaCard}>
              <div>
                <p className={styles.metaLabel}>Unread</p>
                <p className={styles.metaValue}>{summary?.unreadNotifications ?? '—'}</p>
              </div>
              <div className={styles.metaTone}>
                {periodMonth.startDate} → {periodMonth.endDate} UTC (MTD)
              </div>
            </div>
          </div>
        </header>

        <div className={styles.statsGrid}>
          {statCards.map((stat) => (
            <StatTile key={stat.title} {...stat} />
          ))}
        </div>

        <div className={styles.grid}>
            <CardSection
              className={styles.fullWidthCard}
              title="Employees Overview"
              subtitle="Merged users, month-to-date agent rollups (UTC), and task completion (analytics)"
              action="Manage"
              actionHref="/users"
              icon="◉"
              iconTone="linear-gradient(135deg, #0f766e, #0e7490)"
            >
              <div className={styles.employeeGrid}>
                {employees.map((employee) => {
                  const statusColor =
                    employee.status === 'active' ? '#10b981' : employee.status === 'idle' ? '#f59e0b' : '#64748b';
                  return (
                    <article key={employee.name + employee.initials} className={styles.employeeCard}>
                      <div className={styles.employeeTop}>
                        <div className={styles.personRow}>
                          <div className={styles.avatarWrap}>
                            <div className={styles.avatar} style={{ background: employee.tone }}>
                              {employee.initials}
                            </div>
                            <span className={styles.statusDot} style={{ background: statusColor }} />
                          </div>
                          <div>
                            <p className={styles.personName}>{employee.name}</p>
                            <p className={styles.personRole}>{employee.role}</p>
                          </div>
                        </div>
                      </div>

                      <div className={styles.employeeMeta}>
                        <div className={styles.metaRow}>
                          <span>{employee.currentApp}</span>
                          <span className={styles.badge}>{employee.department}</span>
                        </div>
                        <div className={styles.metaRow}>
                          <span>Active: {employee.activeTime}</span>
                          <span>Idle: {employee.idleTime}</span>
                        </div>
                        {employee.status !== 'offline' ? (
                          <div className={styles.progressWrap}>
                            <div className={styles.metaRow}>
                              <span>Productivity</span>
                              <span>{employee.productivity}%</span>
                            </div>
                            <div className={styles.progressBar}>
                              <div
                                className={styles.progressValue}
                                style={{ width: `${Math.min(100, employee.productivity)}%` }}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </CardSection>

            <CardSection
              className={styles.fullWidthCard}
              title="Team Activity Timeline"
              subtitle="Today (UTC) — full 24h bar; falls back to top agents MTD if no desk data today"
              icon="≋"
              iconTone="linear-gradient(135deg, #0f766e, #14b8a6)"
            >
              <div className={styles.timelineAxis}>
                <span />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 0 }}>
                  {['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'].map((time) => (
                    <span key={time}>{time}</span>
                  ))}
                </div>
              </div>
              {timelineEmployees.map((employee) => (
                <div key={employee.name} className={styles.timelineRow}>
                  <div className={styles.personRow}>
                    <div className={styles.avatarWrap}>
                      <div className={styles.avatar} style={{ background: employee.tone }}>
                        {employee.initials}
                      </div>
                    </div>
                    <div>
                      <p className={styles.personName}>{employee.name}</p>
                      <p className={styles.personRole}>{employee.device}</p>
                    </div>
                  </div>
                  <div className={styles.timelineBar}>
                    {employee.segments.map((segment, index) => (
                      <span
                        key={index}
                        className={styles.segment}
                        style={{
                          left: `${segment.left}%`,
                          width: `${segment.width}%`,
                          background: segment.color,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className={styles.legendWrap}>
                {[
                  ['#0f766e', 'Segments'],
                  ['#64748b', 'Gaps'],
                ].map(([color, label]) => (
                  <div key={label} className={styles.legendItem}>
                    <span className={styles.legendDot} style={{ background: color }} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </CardSection>

          <div className={styles.leftColumn}>
            <CardSection
              title="Active Projects"
              subtitle={`${projects.length} loaded for organization`}
              action="Manage"
              actionHref="/projects"
              icon="▣"
              iconTone="linear-gradient(135deg, #0f766e, #0e7490)"
            >
              <div className={`${styles.sectionList} ${styles.cardScrollRegion}`}>
                {projects.slice(0, 8).map((project, idx) => {
                  const tasksForProject = unwrapTasksListPayload(
                    taskQueries[idx]?.data as { data?: Task[] | TaskListResponse } | undefined
                  );
                  const prog = projectProgressFromTasks(project, tasksForProject);
                  const status = projectStatusLabel(project);
                  const memberPayload = memberQueries[idx]?.data;
                  const members =
                    memberPayload && Array.isArray(memberPayload.data) ? memberPayload.data : [];
                  const end = project.end_date
                    ? new Date(project.end_date).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '—';
                  return (
                    <article key={project.project_id} className={styles.projectItem}>
                      <div className={styles.projectHeader}>
                        <div className={styles.personRow}>
                          <span
                            className={styles.legendDot}
                            style={{ background: '#0f766e', width: 10, height: 10 }}
                          />
                          <p className={styles.projectTitle}>{project.name}</p>
                        </div>
                        <span className={styles.badge}>{status}</span>
                      </div>
                      <div className={styles.progressWrap}>
                        <div className={styles.metaRow}>
                          <span>Progress {tasksForProject.length ? '(tasks)' : '(schedule)'}</span>
                          <span>{prog}%</span>
                        </div>
                        <div className={styles.progressBar}>
                          <div className={styles.progressValue} style={{ width: `${prog}%` }} />
                        </div>
                      </div>
                      {members.length ? (
                        <div className={styles.personRow} style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                          {members.slice(0, 8).map((m) => (
                            <div
                              key={m.userId}
                              title={m.name || m.userId}
                              className={styles.avatar}
                              style={{ width: 28, height: 28, fontSize: 11 }}
                            >
                              {initialsFromName(m.name || m.userId || '?')}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className={styles.projectFoot}>
                        <div className={styles.personRow}>
                          <span>{end}</span>
                        </div>
                        <span>ID {project.project_id.slice(0, 8)}…</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </CardSection>

            <CardSection
              title="Goals & OKRs"
              subtitle="Goals for people in your org"
              action="Open"
              actionHref="/goals"
              icon="◎"
              iconTone="linear-gradient(135deg, #f59e0b, #fb923c)"
            >
              <div className={styles.goalSummaryCard}>
                <div>
                  <p className={styles.metaLabel}>Overall avg progress</p>
                  <div className={styles.metricValueRow} style={{ marginTop: 6 }}>
                    <span className={styles.metricValue}>{goalProgressAvg}%</span>
                    <span className={styles.subtleText}>Across {goals.length} goals</span>
                  </div>
                </div>
                <div className={styles.progressWrap} style={{ flex: 1, minWidth: 140 }}>
                  <div className={styles.progressBar} style={{ height: 8 }}>
                    <div
                      className={styles.progressValue}
                      style={{
                        width: `${goalProgressAvg}%`,
                        background: 'linear-gradient(90deg, #0f766e, #14b8a6)',
                      }}
                    />
                  </div>
                </div>
                <span className={goalProgressAvg >= 50 ? styles.okChip : styles.warnChip}>
                  {goalProgressAvg >= 50 ? 'On track' : 'Needs focus'}
                </span>
              </div>

              {goalsListError ? (
                <p className={styles.subtleText} role="alert" style={{ marginBottom: 12 }}>
                  Goals could not be loaded. Verify API access and organization scope.
                </p>
              ) : null}

              <div className={styles.goalCardsGrid}>
                {goals.slice(0, 8).map((goal) => {
                  const progress = goal.progress ?? 0;
                  const onTrack = progress >= 50;
                  return (
                    <Link
                      key={goal.goalId || goal.title}
                      href="/goals"
                      className={styles.goalCard}
                    >
                      <div className={styles.goalHeader}>
                        <p className={styles.goalTitle}>{goal.title}</p>
                        <span className={onTrack ? styles.okChip : styles.warnChip}>
                          {progress >= 100 ? 'Done' : onTrack ? 'On track' : 'At risk'}
                        </span>
                      </div>
                      <div className={styles.progressWrap}>
                        <div className={styles.progressBar}>
                          <div
                            className={styles.progressValue}
                            style={{
                              width: `${progress}%`,
                              background: onTrack
                                ? 'linear-gradient(90deg, #0f766e, #14b8a6)'
                                : 'linear-gradient(90deg, #f59e0b, #f97316)',
                            }}
                          />
                        </div>
                        <div className={styles.goalFoot}>
                          <span>{progress}%</span>
                          <span>Due {goal.deadline?.slice(0, 10) || '—'}</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
              {!goals.length && !goalsListError ? (
                <p className={styles.subtleText} style={{ marginTop: 10 }}>
                  No goals yet for this organization.
                </p>
              ) : null}
            </CardSection>

            <div className={styles.pairRow}>
              <CardSection
                title="Payroll Summary"
                subtitle={`${monthYm} (net pay + overtime)`}
                action="Open"
                actionHref="/payroll"
                icon="⌁"
                iconTone="linear-gradient(135deg, #10b981, #22c55e)"
              >
                <div className={styles.payrollMetrics}>
                  <div className={styles.payrollMetric} style={{ background: 'linear-gradient(135deg, #10b981, #22c55e)' }}>
                    <p className={styles.metaLabel} style={{ color: 'rgba(255,255,255,0.78)' }}>
                      Total net
                    </p>
                    <p className={styles.metaValue} style={{ color: 'var(--dash-stat-text)', marginTop: 6 }}>
                      {formatPkrCompact(payrollTotals.total)}
                    </p>
                  </div>
                  <div className={styles.payrollMetric} style={{ background: 'linear-gradient(135deg, #f59e0b, #fb923c)' }}>
                    <p className={styles.metaLabel} style={{ color: 'rgba(255,255,255,0.78)' }}>
                      Overtime
                    </p>
                    <p className={styles.metaValue} style={{ color: 'var(--dash-stat-text)', marginTop: 6 }}>
                      {formatPkrCompact(payrollTotals.overtime)}
                    </p>
                  </div>
                  <div className={styles.payrollMetric} style={{ background: 'linear-gradient(135deg, #0f766e, #0e7490)' }}>
                    <p className={styles.metaLabel} style={{ color: 'rgba(255,255,255,0.78)' }}>
                      Rows
                    </p>
                    <p className={styles.metaValue} style={{ color: 'var(--dash-stat-text)', marginTop: 6 }}>
                      {payrollRecords.length}
                    </p>
                  </div>
                </div>

                <div className={styles.paymentCard}>
                  <div className={styles.paymentHeader}>
                    <p className={styles.paymentTitle}>Recent payroll rows</p>
                    <span className={styles.smallRow}>Month {monthYm}</span>
                  </div>
                  <div className={`${styles.sectionList} ${styles.payrollRowsScroll}`}>
                    {payrollRecords.slice(0, 5).map((payment, payIdx) => (
                      <div
                        key={payment.payrollId || `${payment.userId}-${payIdx}`}
                        className={styles.projectItem}
                        style={{ background: 'var(--dash-card-solid)' }}
                      >
                        <div className={styles.projectHeader}>
                          <div>
                            <p className={styles.projectTitle}>{payment.employeeName || payment.userId}</p>
                            <p className={styles.subtleText}>{payment.month}</p>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <p className={styles.projectTitle}>{formatPkrCompact(payment.netPay)}</p>
                            <p className={styles.okChip}>Net</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {!payrollRecords.length ? (
                      <p className={styles.subtleText}>No payroll rows for this month.</p>
                    ) : null}
                  </div>
                </div>
              </CardSection>

              <div className={styles.sideStack}>
                <CardSection
                  title="Top Applications"
                  subtitle="Organization totals for today (UTC)"
                  icon="◫"
                  iconTone="linear-gradient(135deg, #0f766e, #14b8a6)"
                >
                  <div className={styles.cardScrollRegion}>
                    {appsByDayError ? (
                      <p className={styles.subtleText} role="alert">
                        Could not load application totals. Check your connection or API configuration.
                      </p>
                    ) : applicationBars.length ? (
                      <div className={styles.sectionList}>
                        {applicationBars.map((app) => (
                          <div
                            key={app.name}
                            className={styles.projectItem}
                            style={{ background: 'var(--dash-card-solid)' }}
                          >
                            <div className={styles.projectHeader}>
                              <p className={styles.projectTitle}>{app.name}</p>
                              <span className={styles.subtleText}>{app.time}</span>
                            </div>
                            <div className={styles.progressBar} style={{ marginTop: 10 }}>
                              <div
                                className={styles.progressValue}
                                style={{
                                  width: `${app.percent}%`,
                                  background: `linear-gradient(90deg, ${app.tone}, ${app.tone})`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.subtleText}>No application activity recorded for this UTC day.</p>
                    )}
                  </div>
                </CardSection>

                <CardSection
                  title="Productivity Trend"
                  subtitle="Org active hours by UTC day (month to date)"
                  icon="▁"
                  iconTone="linear-gradient(135deg, #0f766e, #06b6d4)"
                >
                  <div className={styles.progressWrap}>
                    <div className={`${styles.metaRow} ${styles.productivityTrendRow}`}>
                      {(productivityByDay.length ? productivityByDay : [{ key: '—', hours: 0 }]).map((entry) => (
                        <div key={entry.key} className={styles.productivityBarCell}>
                          <div style={{ height: 96, display: 'flex', alignItems: 'end' }}>
                            <div
                              style={{
                                width: 16,
                                height: `${Math.max(entry.hours * 12, 12)}px`,
                                borderRadius: 999,
                                background: entry.key.includes(String(new Date().getDate()))
                                  ? '#14b8a6'
                                  : '#0f766e',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 10 }}>{entry.key}</span>
                        </div>
                      ))}
                    </div>
                    <div className={styles.metaRow}>
                      <span className={styles.subtleText}>Avg completion (tasks)</span>
                      <span className={styles.metricValue} style={{ fontSize: 18, color: 'var(--color-primary)' }}>
                        {avgCompletion}%
                      </span>
                    </div>
                  </div>
                </CardSection>
              </div>
            </div>
          </div>

          <div className={styles.rightColumn}>
            <CardSection title="Active vs Idle" subtitle="Viewer desk if logged in as user; else org totals" icon="◔" iconTone="linear-gradient(135deg, #06b6d4, #22c55e)">
              <div className={styles.donutWrap}>
                <div className={styles.donut}>
                  <svg viewBox="0 0 132 132" width="132" height="132" aria-hidden="true">
                    <circle cx="66" cy="66" r="54" fill="none" stroke="var(--dash-donut-track)" strokeWidth="16" />
                    <circle
                      cx="66"
                      cy="66"
                      r="54"
                      fill="none"
                      stroke="#06b6d4"
                      strokeWidth="16"
                      strokeDasharray={`${(donutActivePct / 100) * 339.29} ${339.29}`}
                    />
                  </svg>
                  <div className={styles.donutCenter}>
                    <span className={styles.donutValue}>{donutActivePct}%</span>
                    <span className={styles.donutLabel}>Active</span>
                  </div>
                </div>
                <div className={styles.sectionList}>
                  <div className={styles.projectItem} style={{ background: 'var(--dash-card-solid)' }}>
                    <p className={styles.projectTitle}>Active Time</p>
                    <p className={styles.subtleText}>
                      {formatDurationSeconds(meDesk?.activeSeconds ?? summary?.telemetry.totalActiveSeconds ?? 0)}
                    </p>
                  </div>
                  <div className={styles.projectItem} style={{ background: 'var(--dash-card-solid)' }}>
                    <p className={styles.projectTitle}>Idle Time</p>
                    <p className={styles.subtleText}>
                      {formatDurationSeconds(meDesk?.idleSeconds ?? summary?.telemetry.totalIdleSeconds ?? 0)}
                    </p>
                  </div>
                </div>
              </div>
            </CardSection>

            <CardSection
              title="Team ranking"
              subtitle={`${periodMonth.startDate} → ${periodMonth.endDate} UTC · open a row for score breakdown`}
              icon="◆"
              iconTone="linear-gradient(135deg, #6366f1, #22d3ee)"
            >
              <div className={styles.rankingCardInner}>
                {aiRankingPayload ? (
                  <p className={styles.subtleText} style={{ margin: '0 0 8px' }}>
                    {aiRankingPayload.meta.employeeCount} people in cohort
                  </p>
                ) : null}

                {aiRankingLoading && !aiRankingPayload ? (
                  <LoadingIndicator label="Loading rankings…" variant="dots" />
                ) : null}
                {aiRankingIsError ? (
                  <p className={styles.subtleText} role="alert">
                    {aiRankingError instanceof Error ? aiRankingError.message : 'Ranking unavailable.'}
                  </p>
                ) : null}

                {aiRankingPayload ? (
                  <div className={styles.cardScrollRegion}>
                    <div className={styles.rankingList}>
                      {(aiRankingPayload.data.rankings ?? []).map((row) => {
                        const displayName = row.display_name?.trim() || row.employee_id.slice(0, 8);
                        const initials = displayName
                          .split(/\s+/)
                          .filter(Boolean)
                          .map((n) => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase();
                        const expanded = expandedRankingId === row.employee_id;
                        return (
                          <div key={row.employee_id} className={styles.rankingRowOuter}>
                            <button
                              type="button"
                              className={`${styles.rankingRowBtn} ${expanded ? styles.rankingRowBtnOn : ''}`}
                              aria-expanded={expanded}
                              onClick={() =>
                                setExpandedRankingId(expanded ? null : row.employee_id)
                              }
                            >
                              <div
                                className={styles.rank}
                                style={{
                                  background: row.rank === 1 ? '#f59e0b' : '#94a3b8',
                                  color:
                                    row.rank === 1
                                      ? 'var(--dash-rank-1-text)'
                                      : 'var(--dash-rank-2-text)',
                                }}
                              >
                                {row.rank}
                              </div>
                              <div
                                className={styles.avatar}
                                style={{
                                  width: 30,
                                  height: 30,
                                  borderRadius: 10,
                                  background: 'linear-gradient(135deg, #6366f1, #22d3ee)',
                                }}
                              >
                                {initials || '?'}
                              </div>
                              <span className={styles.projectTitle}>{displayName}</span>
                              <span className={styles.projectTitle}>{row.final_score.toFixed(0)}</span>
                              <span className={dashRankingBandClass(row.band)}>{row.band}</span>
                              <span className={styles.rankingChevron} aria-hidden>
                                {expanded ? '▴' : '▾'}
                              </span>
                            </button>
                            {expanded ? (
                              <div className={styles.rankingExpand}>
                                {rankingPillars(row).map((p) => (
                                  <div key={p.label} className={styles.rankingPillarRow}>
                                    <span className={styles.rankingPillarLabel}>{p.label}</span>
                                    <div className={styles.rankingPillarTrack}>
                                      <div
                                        className={styles.rankingPillarFill}
                                        style={{ width: `${Math.min(100, p.value)}%` }}
                                      />
                                    </div>
                                    <span className={styles.rankingPillarVal}>{p.value}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : !aiRankingLoading ? (
                  <p className={styles.subtleText}>No ranking data yet.</p>
                ) : null}
              </div>
            </CardSection>

            <CardSection
              title="Department ranking"
              subtitle={`Average team score by department · ${periodMonth.startDate} → ${periodMonth.endDate} UTC`}
              icon="▣"
              iconTone="linear-gradient(135deg, #0ea5e9, #6366f1)"
            >
              <div className={styles.rankingCardInner}>
                {aiRankingLoading && !aiRankingPayload ? (
                  <LoadingIndicator label="Loading rankings…" variant="dots" />
                ) : null}
                {aiRankingIsError ? (
                  <p className={styles.subtleText} role="alert">
                    {aiRankingError instanceof Error ? aiRankingError.message : 'Ranking unavailable.'}
                  </p>
                ) : null}

                {aiRankingPayload ? (
                  <div className={styles.cardScrollRegion}>
                    <div className={styles.sectionList}>
                      {(aiRankingPayload.data.departments ?? []).map((d) => (
                        <div
                          key={`${d.department_id ?? 'none'}-${d.rank}`}
                          className={`${styles.projectItem} ${styles.deptRankRow}`}
                          style={{ background: 'var(--dash-card-solid)' }}
                        >
                          <div className={styles.deptRankGrid}>
                            <span
                              className={styles.rank}
                              style={{
                                background: d.rank === 1 ? '#f59e0b' : '#94a3b8',
                                color:
                                  d.rank === 1
                                    ? 'var(--dash-rank-1-text)'
                                    : 'var(--dash-rank-2-text)',
                              }}
                            >
                              {d.rank}
                            </span>
                            <p className={styles.projectTitle} style={{ margin: 0 }}>
                              {d.department_name}
                            </p>
                            <span className={styles.subtleText}>{d.member_count} members</span>
                            <span className={styles.okChip}>{d.avg_composite.toFixed(1)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : !aiRankingLoading ? (
                  <p className={styles.subtleText}>No ranking data yet.</p>
                ) : null}
              </div>
            </CardSection>

            <CardSection title="Employee Wellness" subtitle="Mood logs (org)" icon="♥" iconTone="linear-gradient(135deg, #f43f5e, #fb7185)">
              <div className={styles.cardScrollRegion}>
                <div className={styles.wellnessGrid}>
                  <div className={styles.projectItem} style={{ background: 'linear-gradient(135deg, rgba(244, 63, 94, 0.1), rgba(236, 72, 153, 0.08))' }}>
                    <div className={styles.projectHeader}>
                      <p className={styles.projectTitle}>Wellness index</p>
                      <span className={styles.okChip}>{mood.score}</span>
                    </div>
                    <div className={styles.metricValueRow} style={{ marginTop: 12 }}>
                      <span className={styles.metricValue}>{mood.score}</span>
                      <span className={styles.subtleText}>From mood distribution</span>
                    </div>
                    <div className={styles.sectionList} style={{ marginTop: 12 }}>
                      {[`Positive ${mood.happy}`, `Neutral ${mood.neutral}`, `Strained ${mood.stressed}`].map((item) => (
                        <div key={item} className={styles.smallRow}>
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={styles.sectionList}>
                    <div className={styles.metricItem}>
                      <div className={styles.metricHeader}>
                        <span className={styles.subtleText}>Logs (period)</span>
                        <span className={styles.okChip}>{wellnessLogs.length}</span>
                      </div>
                    </div>
                    <div className={styles.metricItem}>
                      <div className={styles.metricHeader}>
                        <span className={styles.subtleText}>Team coverage</span>
                        <span className={styles.warnChip}>{Math.round((summary?.telemetry.coverageRatio ?? 0) * 100)}%</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.sectionList}>
                    <div className={styles.alertList}>
                      {goals
                        .filter((g) => (g.progress || 0) < 40)
                        .slice(0, 2)
                        .map((g) => (
                          <div key={g.goalId} className={styles.alertItem}>
                            <span className={styles.warnChip}>▲</span>
                            <div>
                              <p className={styles.alertTitle}>{g.title}</p>
                              <p className={styles.subtleText}>Goal progress {g.progress ?? 0}%</p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className={styles.sectionList}>
                    <div className={styles.projectItem} style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, var(--dash-card-solid))' }}>
                      <p className={styles.projectTitle}>Analytics</p>
                      <p className={styles.subtleText}>{analyticsOverview?.aiInsights?.explanation ?? 'AI sections use optional analytics microservice.'}</p>
                    </div>
                  </div>
                </div>
                {!wellnessLogs.length ? (
                  <p className={styles.subtleText} style={{ marginTop: 10 }}>
                    No wellness logs in this period. Mood entries will appear here when available.
                  </p>
                ) : null}
              </div>
            </CardSection>

            <CardSection title="AI Insights" subtitle="From analytics/overview when AI data exists; otherwise factual prompts" icon="✦" iconTone="linear-gradient(135deg, #0f766e, #22d3ee)">
              <div className={styles.cardScrollRegion}>
                {insights.length ? (
                  <div className={styles.insightGrid}>
                    {insights.map((insight) => (
                      <article key={insight.title} className={styles.insightCard} style={{ background: insight.bg }}>
                        <div className={styles.insightIcon} style={{ background: insight.bg, color: insight.tone }}>
                          ●
                        </div>
                        <p className={styles.insightTitle}>{insight.title}</p>
                        <p className={styles.insightText}>{insight.description}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className={styles.subtleText}>No insights available for this period. Check back when analytics AI or summary data is present.</p>
                )}
              </div>

            </CardSection>
          </div>
        </div>
      </div>
    </section>
  );
}
