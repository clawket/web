import { useState, useCallback } from 'react';
import type { TaskComment } from '../../types';
import api from '../../api';
import { Label, Input, Textarea, Button } from '../ui';

function formatTime(ts: number | string | null | undefined): string {
  if (ts == null || ts === '') return '\u2014';
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '\u2014';
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function TaskComments({
  taskId,
  comments,
  onCommentsChange,
}: {
  taskId: string;
  comments: TaskComment[];
  onCommentsChange: (comments: TaskComment[]) => void;
}) {
  const [commentAuthor, setCommentAuthor] = useState('main');
  const [commentBody, setCommentBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!commentAuthor.trim() || !commentBody.trim()) return;
    setSubmitting(true);
    try {
      const newComment = await api.createTaskComment(taskId, commentAuthor.trim(), commentBody.trim());
      onCommentsChange([...comments, newComment]);
      setCommentBody('');
    } catch (err) {
      console.error('Failed to add comment:', err);
    } finally {
      setSubmitting(false);
    }
  }, [taskId, commentAuthor, commentBody, comments, onCommentsChange]);

  const handleDelete = useCallback(async (commentId: string) => {
    try {
      await api.deleteTaskComment(commentId);
      onCommentsChange(comments.filter((c) => c.id !== commentId));
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  }, [comments, onCommentsChange]);

  return (
    <div data-testid="task-detail-comments">
      <Label>Comments ({comments.length})</Label>
      {comments.length === 0 ? (
        <div className="text-sm text-muted italic mb-3">No comments yet</div>
      ) : (
        <div className="space-y-2 mb-3">
          {comments.map((c) => (
            <div key={c.id} className="bg-background border border-border rounded p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{c.author}</span>
                  <span className="text-xs text-muted">{formatTime(c.created_at)}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`task-detail-comment-delete-${c.id}`}
                  onClick={() => handleDelete(c.id)}
                  title="Delete comment"
                >
                  &times;
                </Button>
              </div>
              <div className="text-sm text-foreground whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
        </div>
      )}
      <div className="bg-background border border-border rounded p-3 space-y-2">
        <Input
          value={commentAuthor}
          onChange={(e) => setCommentAuthor(e.target.value)}
          placeholder="Author"
          size="sm"
          data-testid="task-detail-comment-author"
        />
        <Textarea
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          placeholder="Write a comment..."
          rows={3}
          size="sm"
          data-testid="task-detail-comment-body"
        />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            data-testid="task-detail-comment-submit"
            onClick={handleAdd}
            disabled={submitting || !commentAuthor.trim() || !commentBody.trim()}
          >
            {submitting ? 'Posting...' : 'Add Comment'}
          </Button>
        </div>
      </div>
    </div>
  );
}
