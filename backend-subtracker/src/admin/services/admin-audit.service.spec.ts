import { Logger } from '@nestjs/common';
import { type EntityManager, QueryFailedError, type Repository } from 'typeorm';
import { AdminAction, type AdminAuditEntry } from '../admin-audit.types.js';
import { AdminStatusFilter } from '../admin-user.types.js';
import { AdminAudit } from '../entities/admin-audit.entity.js';
import { AdminAuditService } from './admin-audit.service.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

function managerWith(insert: (row: Partial<AdminAudit>) => Promise<unknown>) {
  const repository = { insert: vi.fn(insert) };
  const manager = {
    getRepository: (entity: unknown) => {
      expect(entity).toBe(AdminAudit);
      return repository;
    },
  } as unknown as EntityManager;
  return { manager, insert: repository.insert };
}

function serviceWith(manager: EntityManager) {
  return new AdminAuditService({
    manager,
  } as unknown as Repository<AdminAudit>);
}

const SEARCH: AdminAuditEntry = {
  action: AdminAction.SEARCH,
  actorId: ACTOR,
  targetId: null,
  details: { status: AdminStatusFilter.ALL, qLength: 5, results: 2 },
};

describe('AdminAuditService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('record writes the row with the manager it gets and returns its id', async () => {
    const { manager, insert } = managerWith(() =>
      Promise.resolve({ identifiers: [{ id: 'row-1' }] }),
    );

    // The service's own manager is not the transaction's, so it must stay unused.
    const own = managerWith(() => Promise.reject(new Error('own manager')));
    const id = await serviceWith(own.manager).record(manager, {
      action: AdminAction.BLOCK,
      actorId: ACTOR,
      targetId: TARGET,
    });

    expect(id).toBe('row-1');
    expect(own.insert).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith({
      actorId: ACTOR,
      targetId: TARGET,
      action: AdminAction.BLOCK,
      details: null,
    });
  });

  it('recordOutside writes the row with its details', async () => {
    const { manager, insert } = managerWith(() =>
      Promise.resolve({ identifiers: [{ id: 'row-2' }] }),
    );

    await serviceWith(manager).recordOutside(SEARCH);

    expect(insert).toHaveBeenCalledWith({
      actorId: ACTOR,
      targetId: null,
      action: AdminAction.SEARCH,
      details: SEARCH.details,
    });
  });

  it('recordOutside does not throw when the write fails, and logs the code without the message', async () => {
    const errors = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const failure = new QueryFailedError('INSERT', [], {
      code: '57014',
      message: 'canceling statement due to statement timeout',
    } as unknown as Error);
    const { manager } = managerWith(() => Promise.reject(failure));

    await expect(
      serviceWith(manager).recordOutside(SEARCH),
    ).resolves.toBeUndefined();

    expect(errors).toHaveBeenCalledTimes(1);
    const [line, stack] = errors.mock.calls[0] as [string, string];
    expect(line).toContain(AdminAction.SEARCH);
    expect(line).toContain(ACTOR);
    expect(line).toContain('(code: 57014)');
    // The stack keeps its frames but not the message of the failed query.
    expect(stack).toMatch(/^QueryFailedError: <message omitted>\n\s+at /);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('canceling');
  });
});
