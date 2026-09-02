import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore } from './task-store.js';

describe('TaskStore', () => {
  describe('complete', () => {
    it('找到任务后，把 completed 更新为 true 并返回更新后的任务', () => {
      const store = new TaskStore();
      store.add('1', '编写测试');
      const updated = store.complete('1');

      assert.strictEqual(updated.id, '1');
      assert.strictEqual(updated.title, '编写测试');
      assert.strictEqual(updated.completed, true);

      const tasks = store.list();
      assert.strictEqual(tasks[0]?.completed, true);
    });

    it('重复完成同一任务时保持幂等', () => {
      const store = new TaskStore();
      store.add('1', '编写测试');

      const firstCall = store.complete('1');
      assert.strictEqual(firstCall.completed, true);

      const secondCall = store.complete('1');
      assert.strictEqual(secondCall.completed, true);
      assert.strictEqual(secondCall.id, '1');
      assert.strictEqual(secondCall.title, '编写测试');
    });

    it('找不到任务时抛出包含任务 ID 的明确错误', () => {
      const store = new TaskStore();
      store.add('1', '编写测试');

      assert.throws(
        () => {
          store.complete('non-existent-id');
        },
        {
          name: 'Error',
          message: '找不到任务: non-existent-id',
        }
      );
    });

    it('不能改变其他任务', () => {
      const store = new TaskStore();
      store.add('1', '任务一');
      store.add('2', '任务二');

      store.complete('1');

      const tasks = store.list();
      const task1 = tasks.find((t) => t.id === '1');
      const task2 = tasks.find((t) => t.id === '2');

      assert.strictEqual(task1?.completed, true);
      assert.strictEqual(task2?.completed, false);
      assert.strictEqual(task2?.title, '任务二');
    });
  });
});
