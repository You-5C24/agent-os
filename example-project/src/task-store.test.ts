import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore } from './task-store.js';

test('TaskStore.complete - 找到任务后，把 completed 更新为 true 并返回更新后的任务', () => {
  const store = new TaskStore();
  store.add('task-1', '测试任务 1');
  const result = store.complete('task-1');

  assert.equal(result.id, 'task-1');
  assert.equal(result.title, '测试任务 1');
  assert.equal(result.completed, true);

  const list = store.list();
  const task = list.find((t) => t.id === 'task-1');
  assert.equal(task?.completed, true);
});

test('TaskStore.complete - 重复完成同一任务时保持幂等', () => {
  const store = new TaskStore();
  store.add('task-1', '测试任务 1');
  const first = store.complete('task-1');
  const second = store.complete('task-1');

  assert.equal(first.completed, true);
  assert.equal(second.completed, true);
  assert.equal(second.id, 'task-1');
  assert.equal(second.title, '测试任务 1');
});

test('TaskStore.complete - 找不到任务时抛出包含任务 ID 的明确错误', () => {
  const store = new TaskStore();
  assert.throws(
    () => store.complete('non-existent-id'),
    (err: Error) => {
      return err.message.includes('non-existent-id') && err.message.includes('找不到任务');
    }
  );
});

test('TaskStore.complete - 不能改变其他任务', () => {
  const store = new TaskStore();
  store.add('task-1', '任务 1');
  store.add('task-2', '任务 2');
  store.add('task-3', '任务 3');

  store.complete('task-2');

  const tasks = store.list();
  const task1 = tasks.find((t) => t.id === 'task-1');
  const task2 = tasks.find((t) => t.id === 'task-2');
  const task3 = tasks.find((t) => t.id === 'task-3');

  assert.equal(task1?.completed, false);
  assert.equal(task2?.completed, true);
  assert.equal(task3?.completed, false);
});
