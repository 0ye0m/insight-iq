'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useInsightStore } from '@/lib/insightiq/store';
import { sendChat } from '@/lib/insightiq/api';
import { ApiError } from '@/lib/insightiq/api';
import type { ChatMessage } from '@/lib/insightiq/types';
import { SectionTitle, EmptyState, InfoNote } from './ui-bits';
import { MessageSquareText, SendHorizonal, Trash2, ShieldCheck, Database, FileText, ImageIcon, Film } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const SUGGESTIONS_TABULAR = [
  'What is the total revenue?',
  'What is the average of each numeric column?',
  'Which category has the highest value?',
  'Are there missing values?',
  'How many duplicate rows exist?',
];

export default function ChatView() {
  const { files, activeFileId, chat, appendChat, clearChat, setView } = useInsightStore();
  const { toast } = useToast();
  const file = files.find((f) => f.fileId === activeFileId);
  const messages = activeFileId ? chat[activeFileId] || [] : [];
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sending]);

  const send = async (text: string) => {
    if (!file || !text.trim() || sending) return;
    const question = text.trim();
    setInput('');
    appendChat(file.fileId, { role: 'user', content: question, ts: Date.now() });
    setSending(true);
    try {
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const res = await sendChat(file.fileId, question, history);
      appendChat(file.fileId, {
        role: 'assistant',
        content: res.answer,
        sources: res.sources,
        grounded: res.grounded,
        intent: res.intent,
        provider: res.provider,
        ts: Date.now(),
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Chat failed.';
      appendChat(file.fileId, {
        role: 'assistant',
        content: `⚠️ ${msg}`,
        ts: Date.now(),
      });
    } finally {
      setSending(false);
    }
  };

  if (!file) {
    return (
      <EmptyState
        title="Select a dataset to chat about"
        hint="The assistant answers from your actual data: deterministic aggregations for numbers, chunk retrieval for documents, extracted evidence for media. Unsupported questions are refused — never invented."
        action={
          <Button className="btn-gradient-primary rounded-lg" onClick={() => setView('upload')}>
            Go to Upload
          </Button>
        }
      />
    );
  }

  const suggestions = file.category === 'DOCUMENT'
    ? ['Summarize the key points', 'What risks are mentioned?', 'What does the document say about revenue?']
    : file.category === 'IMAGE' || file.category === 'VIDEO'
      ? ['What is shown in this media?', 'What text appears in it?', 'Describe the main subject']
      : SUGGESTIONS_TABULAR;

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-[520px] flex-col space-y-3">
      <SectionTitle
        right={
          messages.length > 0 ? (
            <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => clearChat(file.fileId)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear
            </Button>
          ) : null
        }
      >
        Chat · {file.fileName}
      </SectionTitle>

      <InfoNote>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          Grounded in {file.fileName} only — numbers come from the deterministic engine, document answers cite chunks.
          The assistant says so when your data can&apos;t answer a question.
        </span>
      </InfoNote>

      {/* Messages */}
      <Card className="flex min-h-0 flex-1 flex-col rounded-xl shadow-sm">
        <CardContent ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto scroll-slim p-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                {file.category === 'DOCUMENT' ? <FileText className="h-5 w-5 text-primary" /> : file.category === 'IMAGE' ? <ImageIcon className="h-5 w-5 text-primary" /> : file.category === 'VIDEO' ? <Film className="h-5 w-5 text-primary" /> : <Database className="h-5 w-5 text-primary" />}
              </span>
              <div>
                <p className="text-sm font-medium">Ask anything about this {file.category === 'DOCUMENT' ? 'document' : file.category === 'IMAGE' ? 'image' : file.category === 'VIDEO' ? 'video' : 'dataset'}</p>
                <p className="mt-1 text-xs text-muted-foreground">Try one of the suggestions below</p>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:240ms]" />
              </span>
              computing answer…
            </div>
          )}
        </CardContent>

        {/* Suggestions */}
        <div className="flex flex-wrap gap-1.5 border-t px-3 pt-3">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={sending}
              className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="flex gap-2 p-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask a question about this dataset…"
            aria-label="Your question"
            className="rounded-lg"
          />
          <Button className="btn-gradient-primary rounded-lg" disabled={sending || !input.trim()} onClick={() => send(input)} aria-label="Send">
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-6 ${
          isUser ? 'btn-gradient-primary rounded-br-sm' : 'border bg-secondary/50 rounded-bl-sm'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="space-y-1.5">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
                a: ({ children }) => <span className="underline">{children}</span>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {msg.grounded === 'deterministic' && (
                <Badge variant="outline" className="rounded-md border-emerald-500/40 text-[10px] text-emerald-600">
                  exact engine result
                </Badge>
              )}
              {msg.grounded === 'rag' && (
                <Badge variant="outline" className="rounded-md border-primary/40 text-[10px] text-primary">
                  retrieved chunks
                </Badge>
              )}
              {msg.grounded === 'ai-context' && (
                <Badge variant="outline" className="rounded-md text-[10px]">
                  ai · schema-grounded
                </Badge>
              )}
              {msg.grounded === 'media' && (
                <Badge variant="outline" className="rounded-md text-[10px]">
                  media evidence
                </Badge>
              )}
              {msg.sources?.map((s, i) => (
                <Badge key={i} variant="secondary" className="rounded-md font-mono text-[10px]">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
