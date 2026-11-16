import { apiUrl } from "@/lib/api-url";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

let optimisticMessageSequence = 0;

interface ChatChannel {
  recipientId?: number | null;
  groupId?: number | null;
}

export function useChat({ recipientId = null, groupId = null }: ChatChannel = {}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const channelParams = new URLSearchParams();
  if (recipientId) channelParams.set("recipientId", String(recipientId));
  if (groupId) channelParams.set("groupId", String(groupId));
  const messagesUrl = channelParams.toString()
    ? `${api.chat.list.path}?${channelParams.toString()}`
    : api.chat.list.path;
  const messagesKey = [api.chat.list.path, user?.id ?? null, recipientId ?? null, groupId ?? null] as const;

  const { data: messages, isLoading: isLoadingMessages } = useQuery({
    queryKey: messagesKey,
    queryFn: async () => {
      const res = await fetch(apiUrl(messagesUrl), { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const incoming = await res.json();
      const cachedMessages = queryClient.getQueryData<any[]>(messagesKey);
      if (!Array.isArray(incoming) || !cachedMessages?.length) return incoming;
      const cachedById = new Map(cachedMessages.map((message) => [message.id, message]));
      return incoming.map((message: any) => {
        const cached = cachedById.get(message.id);
        return cached?.mediaUrl && !message.mediaUrl
          ? { ...message, mediaUrl: cached.mediaUrl }
          : message;
      });
    },
    enabled: Boolean(user?.id),
    // Global chat has no recipient/group ID; it must still poll so every device
    // reads the same Neon-backed conversation. Pause background polling to avoid
    // unnecessary requests through mobile webviews and reverse proxies.
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 250,
  });

  const { data: users, isLoading: isLoadingUsers } = useQuery({
    queryKey: [api.chat.users.path],
    queryFn: async () => {
      const res = await fetch(apiUrl(api.chat.users.path), { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    // This endpoint is protected too. Wait until login has populated the
    // authenticated user query, then fetch the directory with the session.
    enabled: Boolean(user?.id),
    refetchInterval: 10000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const sendMessage = useMutation({
    mutationFn: async (data: {
      content: string;
      recipientId?: number;
      groupId?: number;
      mediaUrl?: string | null;
      mediaType?: string | null;
      replyToId?: number | null;
    }) => {
      const res = await fetch(apiUrl(api.chat.send.path), {
        method: api.chat.send.method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        let detail = "Failed to send message";
        try {
          const body = await res.json();
          if (body?.message) detail = String(body.message);
        } catch {}
        throw new Error(detail);
      }
      return res.json();
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: messagesKey });
      const optimisticId = -(++optimisticMessageSequence);
      const optimisticMessage = {
        id: optimisticId,
        senderId: user?.id,
        recipientId: data.recipientId ?? null,
        groupId: data.groupId ?? null,
        content: data.content,
        mediaUrl: data.mediaUrl ?? null,
        mediaType: data.mediaType ?? null,
        hasMedia: Boolean(data.mediaUrl),
        replyToId: data.replyToId ?? null,
        createdAt: new Date().toISOString(),
        senderName: user?.username,
        senderDisplayName: user?.displayName ?? null,
        senderAvatarUrl: user?.avatarUrl ?? null,
        senderNickname: user?.nickname ?? null,
        senderPronouns: user?.pronouns ?? null,
        senderPresenceStatus: user?.presenceStatus ?? "online",
        senderUsernameFont: user?.usernameFont ?? null,
        senderTagSymbol: user?.tagSymbol ?? null,
        senderTagText: user?.tagText ?? null,
        senderTagColor: user?.tagColor ?? null,
      };
      queryClient.setQueryData<any[]>(messagesKey, (current = []) => [
        ...current,
        optimisticMessage,
      ]);
      return { optimisticId };
    },
    onSuccess: (message, _data, context) => {
      queryClient.setQueryData<any[]>(messagesKey, (current = []) => {
        const optimistic = current.find((item) => item.id === context?.optimisticId);
        const completed = {
          ...optimistic,
          ...message,
          mediaUrl: message.mediaUrl ?? optimistic?.mediaUrl ?? null,
          hasMedia: Boolean(message.hasMedia ?? optimistic?.hasMedia ?? message.mediaUrl),
        };
        const withoutOptimistic = current.filter((item) => item.id !== context?.optimisticId);
        const existingIndex = withoutOptimistic.findIndex((item) => item.id === message.id);
        if (existingIndex >= 0) {
          return withoutOptimistic.map((item) => item.id === message.id
            ? { ...completed, ...item, mediaUrl: item.mediaUrl ?? completed.mediaUrl }
            : item);
        }
        return [...withoutOptimistic, completed];
      });
    },
    onError: (error, _data, context) => {
      queryClient.setQueryData<any[]>(messagesKey, (current = []) =>
        current.filter((item) => item.id !== context?.optimisticId)
      );
      toast({
        title: "MESSAGE_NOT_SENT",
        description: error instanceof Error ? error.message : "Check your connection and try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMessage = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(apiUrl(`/api/chat/messages/${id}`), { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey });
    }
  });

  return { messages, users, isLoadingMessages, isLoadingUsers, sendMessage, deleteMessage };
}
