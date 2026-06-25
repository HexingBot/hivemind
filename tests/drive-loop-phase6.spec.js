import { describe, it, expect } from 'vitest';
import { consolidationGate, loopUntilDry } from '../src/drive-loop.js';

describe('consolidationGate — phase/consolidation hard-stop', () => {
  it('stops at each multiple of consolidateEvery', () => {
    expect(consolidationGate({ completedThisRun: 5, consolidateEvery: 5 }).stop).toBe(true);
    expect(consolidationGate({ completedThisRun: 10, consolidateEvery: 5 }).stop).toBe(true);
    expect(consolidationGate({ completedThisRun: 5 }).reason).toMatch(/Consolidation checkpoint/);
  });

  it('does not stop between checkpoints or at zero', () => {
    expect(consolidationGate({ completedThisRun: 4, consolidateEvery: 5 }).stop).toBe(false);
    expect(consolidationGate({ completedThisRun: 6, consolidateEvery: 5 }).stop).toBe(false);
    expect(consolidationGate({ completedThisRun: 0, consolidateEvery: 5 }).stop).toBe(false);
  });

  it('is lifted when auto_consolidate is granted', () => {
    expect(consolidationGate({ completedThisRun: 5, consolidateEvery: 5, autoConsolidate: true }).stop).toBe(false);
  });

  it('is disabled when consolidateEvery is 0', () => {
    expect(consolidationGate({ completedThisRun: 5, consolidateEvery: 0 }).stop).toBe(false);
  });
});

describe('loopUntilDry — inner research loop', () => {
  it('stops after maxDryRounds consecutive dry rounds', async () => {
    // rounds yield: 3, 1, 0, 0  -> stops after the 2nd consecutive dry round
    const yields = [3, 1, 0, 0, 0];
    const r = await loopUntilDry({ runRound: async (i) => yields[i], maxDryRounds: 2, maxRounds: 10 });
    expect(r.rounds).toBe(4);
    expect(r.totalNew).toBe(4);
    expect(r.reason).toMatch(/dry: 2 consecutive/);
  });

  it('resets the dry streak when a round finds something new', async () => {
    // 0, 2, 0, 0 -> the 2 resets the streak; stops after rounds 3 and 4 are both dry
    const yields = [0, 2, 0, 0];
    const r = await loopUntilDry({ runRound: async (i) => yields[i], maxDryRounds: 2 });
    expect(r.rounds).toBe(4);
    expect(r.totalNew).toBe(2);
  });

  it('respects the maxRounds cap when never dry', async () => {
    const r = await loopUntilDry({ runRound: async () => 1, maxDryRounds: 2, maxRounds: 3 });
    expect(r.rounds).toBe(3);
    expect(r.dryStreak).toBe(0);
    expect(r.reason).toMatch(/round cap reached \(3\/3\)/);
  });
});
