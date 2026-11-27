import {
  JobCooperationStatus,
  JobDispatchStatus,
  JobStatus,
  JobWorkStatus,
  Prisma,
} from '@prisma/client';

// The ten stages the admin dashboard shows, in lifecycle order. The backend
// does not store diagnosis, quotes, or quote approvals, so those stages stay
// explicitly untracked instead of being given invented counts.
export enum JobPipelineStage {
  REQUEST = 'request',
  MATCH = 'match',
  ACCEPT = 'accept',
  VISIT = 'visit',
  DIAGNOSE = 'diagnose',
  QUOTE = 'quote',
  APPROVE = 'approve',
  REPAIR = 'repair',
  SETTLE = 'settle',
  RATE = 'rate',
}

export type JobPipelineStageConfig = {
  key: JobPipelineStage;
  label: string;
  tracked: boolean;
  description: string;
  // Null when the backend has no state that proves the stage. Such stages
  // report `count: null` rather than a misleading zero.
  where: Prisma.JobWhereInput | null;
};

// Work has started once the technician is working, has put it on hold or has
// marked it finished. A finished job stays in Repair until the client confirms
// (or the confirmation window closes) and the job becomes COMPLETED.
const WORK_STARTED: JobWorkStatus[] = [
  JobWorkStatus.IN_PROGRESS,
  JobWorkStatus.ON_HOLD,
  JobWorkStatus.COMPLETED,
];

export const JOB_PIPELINE_STAGES: readonly JobPipelineStageConfig[] = [
  {
    key: JobPipelineStage.REQUEST,
    label: 'Request',
    tracked: true,
    description: 'Open jobs still waiting for dispatch to start.',
    where: {
      status: JobStatus.OPEN,
      dispatchStatus: JobDispatchStatus.PENDING,
    },
  },
  {
    key: JobPipelineStage.MATCH,
    label: 'Match',
    tracked: true,
    description:
      'Open jobs where technician offers have gone out but no technician has accepted yet.',
    where: {
      status: JobStatus.OPEN,
      dispatchStatus: {
        in: [
          JobDispatchStatus.OFFERED,
          JobDispatchStatus.EXHAUSTED,
          JobDispatchStatus.STOPPED,
        ],
      },
    },
  },
  {
    key: JobPipelineStage.ACCEPT,
    label: 'Accept',
    tracked: true,
    description:
      'A technician is assigned, but the customer and technician have not both confirmed cooperation.',
    where: {
      status: { in: [JobStatus.ASSIGNED, JobStatus.PAUSED] },
      technicianId: { not: null },
      cooperationStatus: JobCooperationStatus.PENDING,
    },
  },
  {
    key: JobPipelineStage.VISIT,
    label: 'Visit',
    tracked: true,
    description:
      'Cooperation is confirmed and the technician has not started the work yet.',
    where: {
      status: { in: [JobStatus.ASSIGNED, JobStatus.PAUSED] },
      cooperationStatus: JobCooperationStatus.CONFIRMED,
      workStatus: { notIn: WORK_STARTED },
    },
  },
  {
    key: JobPipelineStage.DIAGNOSE,
    label: 'Diagnose',
    tracked: false,
    description:
      'Not tracked: the backend does not record diagnosis separately from work progress.',
    where: null,
  },
  {
    key: JobPipelineStage.QUOTE,
    label: 'Quote',
    tracked: false,
    description:
      'Not tracked: the backend does not record repair quotes or their amounts.',
    where: null,
  },
  {
    key: JobPipelineStage.APPROVE,
    label: 'Approve',
    tracked: false,
    description:
      'Not tracked: the backend does not record customer approval of a repair quote.',
    where: null,
  },
  {
    key: JobPipelineStage.REPAIR,
    label: 'Repair',
    tracked: true,
    description:
      'Cooperation is confirmed and the technician is working, on hold or finished.',
    where: {
      status: { in: [JobStatus.ASSIGNED, JobStatus.PAUSED] },
      cooperationStatus: JobCooperationStatus.CONFIRMED,
      workStatus: { in: WORK_STARTED },
    },
  },
  {
    key: JobPipelineStage.SETTLE,
    label: 'Settle',
    tracked: true,
    description:
      'The work is completed but the customer has not rated it yet.',
    where: { status: JobStatus.COMPLETED, ratedAt: null },
  },
  {
    key: JobPipelineStage.RATE,
    label: 'Rate',
    tracked: true,
    description: 'The work is completed and the customer has rated it.',
    where: { status: JobStatus.COMPLETED, ratedAt: { not: null } },
  },
];

export const JOB_PIPELINE_STAGE_MAP = Object.fromEntries(
  JOB_PIPELINE_STAGES.map((stage) => [stage.key, stage]),
) as Record<JobPipelineStage, JobPipelineStageConfig>;
