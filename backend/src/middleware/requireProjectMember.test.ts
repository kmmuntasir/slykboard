import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireProjectMember } from './requireProjectMember';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-01 Task I — requireProjectMember is now a zero-arg factory that delegates
// resolution+authorization to projectService.getProjectBySlug (non-revealing
// FORBIDDEN for not-found/non-member) and reads the tier via
// membershipService.getMemberRole inside db.transaction. These mocks stand in
// for those deps; the middleware itself is the system under test.

const projectServiceMock = vi.hoisted(() => ({ getProjectBySlug: vi.fn() }));
vi.mock('../services/projectService', () => ({
  getProjectBySlug: projectServiceMock.getProjectBySlug,
}));

const membershipMock = vi.hoisted(() => ({ getMemberRole: vi.fn() }));
vi.mock('../services/membershipService', () => ({
  getMemberRole: membershipMock.getMemberRole,
  isProjectMember: vi.fn(),
}));

// db.transaction(cb) invokes cb with a tx stub; the tx is unused because
// getMemberRole is mocked at the module boundary.
vi.mock('../db/client', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
  },
}));

const MEMBER_ID = 'user-member-id';
const OTHER_ID = 'user-other-id';

const project = {
  id: 'project-1',
  slug: 'team-board',
  name: 'Team Board',
  columns: [],
  creatorId: MEMBER_ID,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const FORBIDDEN_PROJECT = new AppError(
  ErrorCode.FORBIDDEN,
  'You do not have access to this project',
);

describe('requireProjectMember middleware (factory)', () => {
  beforeEach(() => {
    projectServiceMock.getProjectBySlug.mockReset();
    membershipMock.getMemberRole.mockReset();
  });

  it('is a zero-arg factory returning middleware', () => {
    const mw = requireProjectMember();
    expect(typeof mw).toBe('function');
  });

  it('admits a real MEMBER and attaches req.project + req.projectMember', async () => {
    projectServiceMock.getProjectBySlug.mockResolvedValueOnce(project);
    membershipMock.getMemberRole.mockResolvedValueOnce('MEMBER');
    const req = {
      user: { id: MEMBER_ID, email: 'm@example.com', isPlatformAdmin: false },
      params: { slug: 'team-board' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await requireProjectMember()(req, res, next);

    expect(projectServiceMock.getProjectBySlug).toHaveBeenCalledWith(
      'team-board',
      MEMBER_ID,
      false,
    );
    expect(membershipMock.getMemberRole).toHaveBeenCalledWith({}, project.id, MEMBER_ID);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.project).toBe(project);
    expect(req.projectMember).toBe('MEMBER');
  });

  it('admits a PROJECT_ADMIN and attaches the PROJECT_ADMIN tier', async () => {
    projectServiceMock.getProjectBySlug.mockResolvedValueOnce(project);
    membershipMock.getMemberRole.mockResolvedValueOnce('PROJECT_ADMIN');
    const req = {
      user: { id: MEMBER_ID, email: 'm@example.com', isPlatformAdmin: false },
      params: { slug: 'team-board' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await requireProjectMember()(req, res, next);

    expect(req.project).toBe(project);
    expect(req.projectMember).toBe('PROJECT_ADMIN');
    expect(next).toHaveBeenCalledWith();
  });

  it('Platform-Admin bypass: attaches project, projectMember=null, skips role read', async () => {
    projectServiceMock.getProjectBySlug.mockResolvedValueOnce(project);
    const req = {
      user: { id: OTHER_ID, email: 'pa@example.com', isPlatformAdmin: true },
      params: { slug: 'team-board' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await requireProjectMember()(req, res, next);

    expect(membershipMock.getMemberRole).not.toHaveBeenCalled();
    expect(req.project).toBe(project);
    expect(req.projectMember).toBeNull();
    expect(next).toHaveBeenCalledWith();
  });

  it('propagates the non-revealing FORBIDDEN for a non-member (from getProjectBySlug)', async () => {
    projectServiceMock.getProjectBySlug.mockRejectedValueOnce(FORBIDDEN_PROJECT);
    const req = {
      user: { id: OTHER_ID, email: 'other@example.com', isPlatformAdmin: false },
      params: { slug: 'team-board' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(requireProjectMember()(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates the non-revealing FORBIDDEN for an unknown slug (anti-oracle)', async () => {
    projectServiceMock.getProjectBySlug.mockRejectedValueOnce(FORBIDDEN_PROJECT);
    const req = {
      user: { id: OTHER_ID, email: 'other@example.com', isPlatformAdmin: false },
      params: { slug: 'does-not-exist' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(requireProjectMember()(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('throws UNAUTHENTICATED without hitting the DB when req.user is absent', async () => {
    const req = { user: undefined, params: { slug: 'team-board' } } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(requireProjectMember()(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
    });
    expect(projectServiceMock.getProjectBySlug).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
