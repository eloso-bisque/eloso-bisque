"use client";

import OutreachTaskCard from "./OutreachTaskCard";
import type { OutreachTask, GeneratedMessage } from "@/lib/outreach";

interface OutreachTaskListProps {
  tasks: OutreachTask[];
  messages: GeneratedMessage[];
}

export default function OutreachTaskList({ tasks, messages }: OutreachTaskListProps) {
  const messageMap = new Map(messages.map((m) => [m.task.id, m]));

  if (tasks.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-bisque-100 p-12 text-center">
        <div className="text-4xl mb-3">📭</div>
        <p className="text-bisque-600 font-medium">No outreach tasks assigned</p>
        <p className="text-bisque-400 text-sm mt-1">
          Contacts will appear here as they are added to the CRM with the{" "}
          <code className="text-bisque-500">prospect-contact</code> tag.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-bisque-500">
        {tasks.length} contact{tasks.length !== 1 ? "s" : ""} assigned
      </p>
      {tasks.map((task) => {
        const msg = messageMap.get(task.id);
        if (!msg) return null;
        return <OutreachTaskCard key={task.id} task={task} message={msg} />;
      })}
    </div>
  );
}
