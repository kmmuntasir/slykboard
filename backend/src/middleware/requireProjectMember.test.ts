import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireProjectMember } from './requireProjectMember';
import { ErrorCode } from '../utils/envelope';

// Hoisted mock for projectService. Tests set return values per-case.
const projectServiceMock = vi.hoisted(() => ({ getProjectBySlug: vi.fn() }));
vi.mock('../services/projectService', () => ({
  getProjectBySlug: projectServiceMock.getProjectBySlug,
}));

const CREATOR_ID = 'user-creator-id';
const OTHER_ID = 'user-other-id';

const project = {
  id: 'project-1',
  slug: 'team-board',
  name: 'Team Board',
  columns: [],
  creatorId: CREATOR_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('requireProjectMember middleware', () => {
  beforeEach(() => {
    projectServiceMock.getProjectBySlug.mockReset();
  });

  it('allows the creator and attaches req.project', async () => {
    projectServiceMock.getProjectBySlug.mockResolvedValueOnce(project);
    const req = {
      user: { id: CREATOR_ID, email: 'creator@example.com', isPlatformAdmin: false },
      params: { slug: 'team-board' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await requireProjectMember(req, res, next);

    expect(projectServiceMock.getProjectBySlug).toHaveBeenCalledWith('team-board');
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.project).toBe(project);
  });

  it('throws FORBIDDEN for a non-member', async () => {
    projectServiceMock.getProjectBySlug.mockResolvedValueOnce(project);
    const req = {
      user: { id: OTHER_ID, email: 'other@example.com', isPlatformAdmin: false },
      params: { slug: 'team-board' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(requireProjectMember(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN for an unknown slug (existence hidden)', async () => {
    projectServiceMock.getProjectBySlug.mockResolvedValueOnce(null);
    const req = {
      user: { id: OTHER_ID, email: 'other@example.com', isPlatformAdmin: false },
      params: { slug: 'does-not-exist' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(requireProjectMember(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a Platform Admin even when not the creator', async () => {
    projectServiceMock.getProjectBySlug.mockResolvedValueOnce(project);
    const req = {
      user: { id: OTHER_ID, email: 'admin@example.com', isPlatformAdmin: true },
      params: { slug: 'team-board' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await requireProjectMember(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.project).toBe(project);
  });

  it('throws UNAUTHENTICATED without hitting the DB when req.user is absent', async () => {
    const req = { user: undefined, params: { slug: 'team-board' } } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(requireProjectMember(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
    });
    expect(projectServiceMock.getProjectBySlug).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
