import {
  JobCooperationStatus,
  JobDispatchStatus,
  JobProgressStatus,
  JobStatus,
} from '@prisma/client';
import {
  JOB_PIPELINE_STAGES,
  JOB_PIPELINE_STAGE_MAP,
  JobPipelineStage,
} from './job-pipeline';

describe('job pipeline stages', () => {
  it('lists the ten dashboard stages in lifecycle order', () => {
    expect(JOB_PIPELINE_STAGES.map((stage) => stage.key)).toEqual([
      JobPipelineStage.REQUEST,
      JobPipelineStage.MATCH,
      JobPipelineStage.ACCEPT,
      JobPipelineStage.VISIT,
      JobPipelineStage.DIAGNOSE,
      JobPipelineStage.QUOTE,
      JobPipelineStage.APPROVE,
      JobPipelineStage.REPAIR,
      JobPipelineStage.SETTLE,
      JobPipelineStage.RATE,
    ]);
    expect(JOB_PIPELINE_STAGES.map((stage) => stage.label)).toEqual([
      'Request',
      'Match',
      'Accept',
      'Visit',
      'Diagnose',
      'Quote',
      'Approve',
      'Repair',
      'Settle',
      'Rate',
    ]);
  });

  it('marks only the stages the backend cannot prove as untracked', () => {
    const untracked = JOB_PIPELINE_STAGES.filter((stage) => !stage.tracked);

    expect(untracked.map((stage) => stage.key)).toEqual([
      JobPipelineStage.DIAGNOSE,
      JobPipelineStage.QUOTE,
      JobPipelineStage.APPROVE,
    ]);
    for (const stage of untracked) expect(stage.where).toBeNull();
    for (const stage of JOB_PIPELINE_STAGES) {
      expect(stage.tracked).toBe(stage.where !== null);
    }
  });

  it('indexes every stage by its key', () => {
    for (const stage of JOB_PIPELINE_STAGES) {
      expect(JOB_PIPELINE_STAGE_MAP[stage.key]).toBe(stage);
    }
  });

  it('counts requests that are open and still waiting for dispatch', () => {
    expect(JOB_PIPELINE_STAGE_MAP[JobPipelineStage.REQUEST].where).toEqual({
      status: JobStatus.OPEN,
      dispatchStatus: JobDispatchStatus.PENDING,
    });
  });

  it('counts matches that are open with an offer round underway', () => {
    expect(JOB_PIPELINE_STAGE_MAP[JobPipelineStage.MATCH].where).toEqual({
      status: JobStatus.OPEN,
      dispatchStatus: {
        in: [
          JobDispatchStatus.OFFERED,
          JobDispatchStatus.EXHAUSTED,
          JobDispatchStatus.STOPPED,
        ],
      },
    });
  });

  it('counts accepts as assigned jobs awaiting mutual cooperation', () => {
    expect(JOB_PIPELINE_STAGE_MAP[JobPipelineStage.ACCEPT].where).toEqual({
      status: { in: [JobStatus.ASSIGNED, JobStatus.PAUSED] },
      technicianId: { not: null },
      cooperationStatus: JobCooperationStatus.PENDING,
    });
  });

  it('splits confirmed cooperation into visit and repair by work progress', () => {
    const started = [
      JobProgressStatus.IN_PROGRESS,
      JobProgressStatus.COMPLETED,
    ];

    expect(JOB_PIPELINE_STAGE_MAP[JobPipelineStage.VISIT].where).toEqual({
      status: { in: [JobStatus.ASSIGNED, JobStatus.PAUSED] },
      cooperationStatus: JobCooperationStatus.CONFIRMED,
      customerProgress: { notIn: started },
      technicianProgress: { notIn: started },
    });
    expect(JOB_PIPELINE_STAGE_MAP[JobPipelineStage.REPAIR].where).toEqual({
      status: { in: [JobStatus.ASSIGNED, JobStatus.PAUSED] },
      cooperationStatus: JobCooperationStatus.CONFIRMED,
      OR: [
        { customerProgress: { in: started } },
        { technicianProgress: { in: started } },
      ],
    });
  });

  it('partitions completed jobs into settle and rate by the rating timestamp', () => {
    expect(JOB_PIPELINE_STAGE_MAP[JobPipelineStage.SETTLE].where).toEqual({
      status: JobStatus.COMPLETED,
      ratedAt: null,
    });
    expect(JOB_PIPELINE_STAGE_MAP[JobPipelineStage.RATE].where).toEqual({
      status: JobStatus.COMPLETED,
      ratedAt: { not: null },
    });
  });
});
