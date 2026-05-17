import { useState, useEffect } from 'react';
import type { Task } from '../../types';
import api from '../../api';
import { Label } from '../ui';
import { SubtaskCreateModal } from '../SubtaskCreateModal';

const TASK_STATUS_ICON: Record<Task['status'], { icon: string; color: string }> = {
  todo: { icon: '○', color: 'text-muted' },
  in_progress: { icon: '◐', color: 'text-warning' },
  done: { icon: '●', color: 'text-success' },
  blocked: { icon: '⊘', color: 'text-danger' },
  cancelled: { icon: '✕', color: 'text-muted' },
};

function SubTaskTree({ tasks, depth = 0 }: { tasks: Task[]; depth?: number }) {
  const [childMap, setChildMap] = useState<Record<string, Task[]>>({});

  useEffect(() => {
    if (depth >= 3) return;
    const ids = tasks.map((s) => s.id);
    Promise.all(ids.map((id) => api.listChildTasks(id).catch(() => [] as Task[]))).then(
      (results) => {
        const map: Record<string, Task[]> = {};
        ids.forEach((id, i) => {
          if (results[i].length > 0) map[id] = results[i];
        });
        setChildMap(map);
      },
    );
  }, [tasks, depth]);

  return (
    <>
      {tasks.map((s) => {
        const si = TASK_STATUS_ICON[s.status];
        const children = childMap[s.id];
        return (
          <div key={s.id}>
            <div className="flex items-center gap-2 px-3 py-1.5" style={{ paddingLeft: `${12 + depth * 16}px` }}>
              <span className={`${si.color} text-sm`}>{si.icon}</span>
              <span className="text-xs text-muted font-mono">{s.ticket_number ?? `...${s.id.slice(-6)}`}</span>
              <span className="text-sm text-foreground truncate flex-1">{s.title}</span>
              {s.assignee && <span className="text-xs text-muted">@{s.assignee}</span>}
            </div>
            {children && <SubTaskTree tasks={children} depth={depth + 1} />}
          </div>
        );
      })}
    </>
  );
}

export function TaskSubTasks({
  task,
  childTasks,
  onChildCreated,
}: {
  task: Task;
  childTasks: Task[];
  onChildCreated: (child: Task) => void;
}) {
  const [showModal, setShowModal] = useState(false);

  return (
    <div>
      <Label>Sub-Tasks ({childTasks.length})</Label>
      {childTasks.length === 0 ? (
        <div className="text-sm text-muted italic">No sub-tasks</div>
      ) : (
        <div className="bg-background border border-border rounded overflow-hidden divide-y divide-border">
          <SubTaskTree tasks={childTasks} />
        </div>
      )}
      <button
        type="button"
        data-testid="task-detail-add-subtask"
        className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-primary transition-colors cursor-pointer"
        onClick={() => setShowModal(true)}
      >
        <span className="text-base leading-none">+</span> Add sub-task
      </button>
      {showModal && (
        <SubtaskCreateModal
          parent={task}
          onClose={() => setShowModal(false)}
          onCreated={(child) => {
            onChildCreated(child);
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}
