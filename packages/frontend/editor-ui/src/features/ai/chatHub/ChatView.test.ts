import { describe, it, beforeEach, expect, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createComponentRenderer } from '@/__tests__/render';
import {
	createMockModelsResponse,
	createMockAgent,
	createMockConversationResponse,
	createMockSession,
	createMockMessageDto,
	createMockStreamChunk,
} from './__test__/data';
import ChatView from './ChatView.vue';
import * as chatApi from './chat.api';
import userEvent from '@testing-library/user-event';
import { waitFor, within } from '@testing-library/vue';

/**
 * ChatView.vue Tests
 *
 * Main chat interface where users interact with AI agents
 * Key features:
 * - Display chat messages
 * - Send new messages
 * - Handle streaming responses
 * - Model selection
 * - Session management
 */

// Mock external stores and modules
vi.mock('@/features/settings/users/users.store', () => ({
	useUsersStore: () => ({
		currentUserId: 'user-123',
		currentUser: {
			id: 'user-123',
			firstName: 'Test',
			fullName: 'Test User',
		},
	}),
}));

vi.mock('@/app/stores/ui.store', () => ({
	useUIStore: () => ({
		openModal: vi.fn(),
		modalsById: {},
	}),
}));

vi.mock('@/features/credentials/credentials.store', () => ({
	useCredentialsStore: () => ({
		fetchCredentialTypes: vi.fn().mockResolvedValue(undefined),
		fetchAllCredentials: vi.fn().mockResolvedValue(undefined),
		getCredentialById: vi.fn().mockReturnValue(undefined),
		getCredentialsByType: vi.fn().mockReturnValue([]),
		getCredentialTypeByName: vi.fn().mockReturnValue(undefined),
	}),
}));

vi.mock('./chat.api');

// Create a reactive route object that can be shared
import { reactive } from 'vue';
const mockRoute = reactive<{ params: Record<string, any>; query: Record<string, any> }>({
	params: {},
	query: {},
});

const mockRouterPush = vi.fn((route) => {
	// Simulate route navigation by updating mockRoute
	if (typeof route === 'object' && route.params) {
		Object.assign(mockRoute.params, route.params);
	}
});

vi.mock('vue-router', async (importOriginal) => {
	const actual = await importOriginal<typeof import('vue-router')>();

	return {
		...actual,
		useRoute: () => mockRoute,
		useRouter: () => ({
			push: mockRouterPush,
			resolve: vi.fn(),
		}),
	};
});

const renderComponent = createComponentRenderer(ChatView);

describe('ChatView', () => {
	let pinia: ReturnType<typeof createPinia>;

	beforeEach(() => {
		pinia = createPinia();
		setActivePinia(pinia);

		// Reset route to initial state
		mockRoute.params = {};
		mockRoute.query = {};
		mockRouterPush.mockClear();

		// Clear all API mocks
		vi.mocked(chatApi.sendMessageApi).mockClear();
		vi.mocked(chatApi.editMessageApi).mockClear();
		vi.mocked(chatApi.regenerateMessageApi).mockClear();
		vi.mocked(chatApi.stopGenerationApi).mockClear();

		// Mock chat API with default response including common agents
		vi.mocked(chatApi.fetchChatModelsApi).mockResolvedValue(
			createMockModelsResponse({
				'custom-agent': {
					models: [
						createMockAgent({
							name: 'Test Custom Agent',
							description: 'A test custom agent',
							model: { provider: 'custom-agent', agentId: 'agent-123' },
						}),
					],
				},
			}),
		);
		vi.mocked(chatApi.fetchSingleConversationApi).mockResolvedValue(
			createMockConversationResponse({
				session: createMockSession({
					id: 'session-id',
					provider: null,
					model: null,
				}),
			}),
		);
		vi.mocked(chatApi.fetchConversationsApi).mockResolvedValue([]);
	});

	describe('Initial rendering', () => {
		it('displays chat starter for new session, conversation header, and prompt input', async () => {
			const rendered = renderComponent({ pinia });

			// Should not display message list for new session (role="log" is only for existing conversations)
			expect(rendered.queryByRole('log')).not.toBeInTheDocument();

			// Should display chat starter greeting
			expect(await rendered.findByText('Hello, Test!')).toBeInTheDocument();

			// Should display prompt input
			expect(await rendered.findByRole('textbox')).toBeInTheDocument();
		});

		it('displays existing conversation with messages loaded from API', async () => {
			// Set up route with existing session ID
			mockRoute.params = { id: 'existing-session-123' };

			// Mock existing conversation with messages
			vi.mocked(chatApi.fetchSingleConversationApi).mockResolvedValue(
				createMockConversationResponse({
					session: createMockSession({
						id: 'existing-session-123',
						title: 'Test Conversation',
						lastMessageAt: new Date().toISOString(),
						provider: 'custom-agent',
						agentId: 'agent-123',
						agentName: 'Test Custom Agent',
					}),
					conversation: {
						messages: {
							'msg-1': createMockMessageDto({
								id: 'msg-1',
								sessionId: 'existing-session-123',
								content: 'What is the weather today?',
							}),
							'msg-2': createMockMessageDto({
								id: 'msg-2',
								sessionId: 'existing-session-123',
								type: 'ai',
								name: 'Assistant',
								content: 'The weather is sunny today.',
								provider: 'custom-agent',
								agentId: 'agent-123',
								previousMessageId: 'msg-1',
							}),
						},
					},
				}),
			);

			const rendered = renderComponent({ pinia });

			// Wait for messages to be displayed
			expect(await rendered.findByRole('log')).toBeInTheDocument();

			// Wait for the last message to appear
			expect(await rendered.findByText('The weather is sunny today.')).toBeInTheDocument();

			// Verify all messages are displayed in order
			const messages = rendered.queryAllByTestId('chat-message');
			expect(messages).toHaveLength(2);
			expect(messages[0]).toHaveTextContent('What is the weather today?');
			expect(messages[1]).toHaveTextContent('The weather is sunny today.');
		});

		it('handles when the agent selected for the conversation is not available anymore', async () => {
			// Set up route with existing session ID
			mockRoute.params = { id: 'existing-session-123' };

			// Mock agents response WITHOUT the agent that was used in the conversation
			vi.mocked(chatApi.fetchChatModelsApi).mockResolvedValue(
				createMockModelsResponse({
					openai: {
						models: [
							createMockAgent({
								name: 'GPT-4',
								model: { provider: 'openai', model: 'gpt-4' },
							}),
						],
					},
					// Note: anthropic agent 'claude-3-sonnet' is NOT available
				}),
			);

			// Mock existing conversation that used an anthropic agent that's no longer available
			vi.mocked(chatApi.fetchSingleConversationApi).mockResolvedValue(
				createMockConversationResponse({
					session: createMockSession({
						id: 'existing-session-123',
						title: 'Existing Conversation',
						lastMessageAt: new Date().toISOString(),
						provider: 'anthropic',
						model: 'claude-3-sonnet', // This model is not in the available agents
						agentId: null,
						agentName: null,
					}),
				}),
			);

			const rendered = renderComponent({ pinia });

			// Should display the "reselect a model" message since the agent is not available
			expect(await rendered.findByText(/reselect a model/i)).toBeInTheDocument();

			// Verify the textarea is disabled when agent is not available
			const textarea = (await rendered.findByRole('textbox')) as HTMLTextAreaElement;
			expect(textarea).toBeDisabled();
		});
	});

	describe('Sending messages', () => {
		it('sends message in new session, calls API, navigates to conversation view, and displays user message', async () => {
			const user = userEvent.setup();

			// Set route query parameter to select the custom agent
			mockRoute.query = { agentId: 'agent-123' };

			// Mock sendMessage API to simulate streaming response
			vi.mocked(chatApi.sendMessageApi).mockImplementation(
				(_ctx, payload, onMessageUpdated, onDone) => {
					// Simulate streaming synchronously
					void Promise.resolve().then(async () => {
						onMessageUpdated(
							createMockStreamChunk({
								type: 'begin',
								content: '',
								metadata: {
									messageId: 'ai-message-123',
									previousMessageId: payload.messageId,
								},
							}),
						);

						onMessageUpdated(
							createMockStreamChunk({
								type: 'item',
								content: 'Hello! How can I help?',
								metadata: {
									messageId: 'ai-message-123',
									previousMessageId: payload.messageId,
								},
							}),
						);

						onMessageUpdated(
							createMockStreamChunk({
								type: 'end',
								content: '',
								metadata: {
									messageId: 'ai-message-123',
									previousMessageId: payload.messageId,
								},
							}),
						);

						onDone();
					});
				},
			);

			const rendered = renderComponent({ pinia });

			// Find the textarea
			const textarea = (await rendered.findByRole('textbox')) as HTMLTextAreaElement;

			// Type a message and press Enter
			await user.click(textarea);
			await user.type(textarea, 'Hello, AI!{Enter}');

			// Wait for the message list to appear (indicates session is no longer "new")
			expect(await rendered.findByRole('log')).toBeInTheDocument();

			// Verify the input was cleared
			expect(textarea.value).toBe('');

			// Verify sendMessageApi was called with correct parameters
			expect(chatApi.sendMessageApi).toHaveBeenCalledWith(
				expect.anything(), // restApiContext
				expect.objectContaining({
					message: 'Hello, AI!',
					model: { provider: 'custom-agent', agentId: 'agent-123' },
					sessionId: expect.any(String),
					credentials: {},
				}),
				expect.any(Function), // onStreamMessage
				expect.any(Function), // onStreamDone
				expect.any(Function), // onStreamError
			);

			// Extract the session ID from the API call
			const apiCallArgs = vi.mocked(chatApi.sendMessageApi).mock.calls[0];
			const sessionIdFromApi = apiCallArgs[1].sessionId;

			// Verify navigation to conversation view with same session ID
			expect(mockRouterPush).toHaveBeenCalledWith({
				name: 'chat-conversation',
				params: { id: sessionIdFromApi },
			});

			// Wait for the last message to appear (AI response)
			expect(await rendered.findByText('Hello! How can I help?')).toBeInTheDocument();

			// Verify all messages
			const messages = rendered.queryAllByTestId('chat-message');
			expect(messages).toHaveLength(2);
			expect(messages[0]).toHaveTextContent('Hello, AI!');
			expect(messages[1]).toHaveTextContent('Hello! How can I help?');
		});

		it('sends message in existing session and displays both user and AI messages', async () => {
			const user = userEvent.setup();

			// Set up route with existing session ID
			mockRoute.params = { id: 'existing-session-123' };

			// Mock existing conversation with existing messages
			vi.mocked(chatApi.fetchSingleConversationApi).mockResolvedValue(
				createMockConversationResponse({
					session: createMockSession({
						id: 'existing-session-123',
						title: 'Existing Conversation',
						lastMessageAt: new Date().toISOString(),
						provider: 'custom-agent',
						agentId: 'agent-123',
						agentName: 'Test Custom Agent',
					}),
					conversation: {
						messages: {
							'msg-1': createMockMessageDto({
								id: 'msg-1',
								sessionId: 'existing-session-123',
								content: 'Previous question',
							}),
							'msg-2': createMockMessageDto({
								id: 'msg-2',
								sessionId: 'existing-session-123',
								type: 'ai',
								name: 'Assistant',
								content: 'Previous answer',
								provider: 'openai',
								model: 'gpt-4',
								previousMessageId: 'msg-1',
							}),
						},
					},
				}),
			);

			// Mock sendMessage API to simulate streaming response (BEFORE component renders)
			vi.mocked(chatApi.sendMessageApi).mockImplementation(
				(_ctx, payload, onMessageUpdated, onDone) => {
					// Simulate streaming synchronously
					void Promise.resolve().then(async () => {
						onMessageUpdated(
							createMockStreamChunk({
								type: 'begin',
								content: '',
								metadata: {
									messageId: 'ai-message-456',
									previousMessageId: payload.messageId,
								},
							}),
						);

						onMessageUpdated(
							createMockStreamChunk({
								type: 'item',
								content: 'AI response here',
								metadata: {
									messageId: 'ai-message-456',
									previousMessageId: payload.messageId,
								},
							}),
						);

						onMessageUpdated(
							createMockStreamChunk({
								type: 'end',
								content: '',
								metadata: {
									messageId: 'ai-message-456',
									previousMessageId: payload.messageId,
								},
							}),
						);

						onDone();
					});
				},
			);

			const rendered = renderComponent({ pinia });

			// Wait for existing messages to be displayed (component fetches automatically)
			expect(await rendered.findByRole('log')).toBeInTheDocument();

			// Find the textarea
			const textarea = (await rendered.findByRole('textbox')) as HTMLTextAreaElement;

			// Type a message and press Enter
			await user.click(textarea);
			await user.type(textarea, 'New question{Enter}');

			// Verify the input was cleared
			expect(textarea.value).toBe('');

			// Verify sendMessageApi was called with correct parameters
			expect(chatApi.sendMessageApi).toHaveBeenCalledWith(
				expect.anything(), // restApiContext
				expect.objectContaining({
					message: 'New question',
					model: { provider: 'custom-agent', agentId: 'agent-123' },
					sessionId: 'existing-session-123',
					credentials: {},
					previousMessageId: 'msg-2',
				}),
				expect.any(Function), // onStreamMessage
				expect.any(Function), // onStreamDone
				expect.any(Function), // onStreamError
			);

			// Wait for the last message to appear (new AI response)
			expect(await rendered.findByText('AI response here')).toBeInTheDocument();

			// Verify all messages
			const messages = rendered.queryAllByTestId('chat-message');
			expect(messages).toHaveLength(4);
			expect(messages[0]).toHaveTextContent('Previous question');
			expect(messages[1]).toHaveTextContent('Previous answer');
			expect(messages[2]).toHaveTextContent('New question');
			expect(messages[3]).toHaveTextContent('AI response here');

			// Verify no navigation happens (already on conversation view)
			expect(mockRouterPush).not.toHaveBeenCalled();
		});

		it('stops streaming when user clicks stop button and calls stopGeneration API', async () => {
			const user = userEvent.setup();

			// Set route query parameter to select the custom agent
			mockRoute.query = { agentId: 'agent-123' };

			// Mock sendMessage API to simulate streaming that we'll interrupt
			vi.mocked(chatApi.sendMessageApi).mockImplementation(
				(_ctx, payload, onMessageUpdated, _onDone) => {
					// Simulate streaming synchronously
					void Promise.resolve().then(async () => {
						onMessageUpdated(
							createMockStreamChunk({
								type: 'begin',
								content: '',
								metadata: {
									messageId: 'ai-message-123',
									previousMessageId: payload.messageId,
								},
							}),
						);

						onMessageUpdated(
							createMockStreamChunk({
								type: 'item',
								content: 'Starting response...',
								metadata: {
									messageId: 'ai-message-123',
									previousMessageId: payload.messageId,
								},
							}),
						);

						// Don't call onDone - simulate interrupted streaming
					});
				},
			);

			// Mock stopGeneration API
			vi.mocked(chatApi.stopGenerationApi).mockResolvedValue(undefined);

			const rendered = renderComponent({ pinia });

			// Find the textarea
			const textarea = (await rendered.findByRole('textbox')) as HTMLTextAreaElement;

			// Type a message and press Enter
			await user.click(textarea);
			await user.type(textarea, 'Hello, AI!{Enter}');

			// Wait for the stop button to appear and click it
			await user.click(await rendered.findByRole('button', { name: /stop generating/i }));

			// Extract the session ID from the sendMessage call
			const sendApiCall = vi.mocked(chatApi.sendMessageApi).mock.calls[0];
			const sessionId = sendApiCall[1].sessionId;

			// Verify stopGenerationApi was called with correct parameters
			await waitFor(() => {
				expect(chatApi.stopGenerationApi).toHaveBeenCalledWith(
					expect.anything(), // restApiContext
					sessionId,
					'ai-message-123', // AI message ID being stopped
				);
			});
		});
	});

	describe('Model selection', () => {
		it.todo('updates session model when user selects different model in existing conversation');
		it.todo('saves to localStorage when user selects model in new session');
	});

	describe('Message actions', () => {
		it('regenerates AI response when user clicks regenerate button', async () => {
			const user = userEvent.setup();

			// Set up route with existing session ID
			mockRoute.params = { id: 'existing-session-123' };

			// Mock existing conversation with AI message
			vi.mocked(chatApi.fetchSingleConversationApi).mockResolvedValue(
				createMockConversationResponse({
					session: createMockSession({
						id: 'existing-session-123',
						provider: 'custom-agent',
						agentId: 'agent-123',
						agentName: 'Test Custom Agent',
					}),
					conversation: {
						messages: {
							'msg-1': createMockMessageDto({
								id: 'msg-1',
								sessionId: 'existing-session-123',
								content: 'What is 2+2?',
							}),
							'msg-2': createMockMessageDto({
								id: 'msg-2',
								sessionId: 'existing-session-123',
								type: 'ai',
								name: 'Assistant',
								content: 'Original response: 4',
								provider: 'custom-agent',
								agentId: 'agent-123',
								previousMessageId: 'msg-1',
							}),
						},
					},
				}),
			);

			// Mock regenerateMessage API
			vi.mocked(chatApi.regenerateMessageApi).mockImplementation(
				(_ctx, _sessionId, _retryId, _payload, onMessageUpdated, onDone) => {
					void Promise.resolve().then(async () => {
						onMessageUpdated(
							createMockStreamChunk({
								type: 'begin',
								content: '',
								metadata: {
									messageId: 'ai-message-retry-123',
									retryOfMessageId: 'msg-2',
									previousMessageId: 'msg-1',
								},
							}),
						);

						onMessageUpdated(
							createMockStreamChunk({
								type: 'item',
								content: 'Regenerated response: Two plus two equals four.',
								metadata: {
									messageId: 'ai-message-retry-123',
									retryOfMessageId: 'msg-2',
									previousMessageId: 'msg-1',
								},
							}),
						);

						onMessageUpdated(
							createMockStreamChunk({
								type: 'end',
								content: '',
								metadata: {
									messageId: 'ai-message-retry-123',
									retryOfMessageId: 'msg-2',
									previousMessageId: 'msg-1',
								},
							}),
						);

						onDone();
					});
				},
			);

			const rendered = renderComponent({ pinia });

			// Wait for existing messages to be displayed
			expect(await rendered.findByRole('log')).toBeInTheDocument();

			// Wait for the original message to appear first
			expect(await rendered.findByText('Original response: 4')).toBeInTheDocument();

			// Find the regenerate button by its accessible label
			const regenerateButton = await rendered.findByRole('button', { name: 'Regenerate' });
			await user.click(regenerateButton);

			// Verify regenerateMessageApi was called with correct parameters
			await waitFor(() => {
				expect(chatApi.regenerateMessageApi).toHaveBeenCalledWith(
					expect.anything(), // restApiContext
					'existing-session-123', // sessionId
					'msg-2', // retryId (the AI message ID to retry)
					expect.objectContaining({
						model: { provider: 'custom-agent', agentId: 'agent-123' },
						credentials: {},
					}),
					expect.any(Function), // onStreamMessage
					expect.any(Function), // onStreamDone
					expect.any(Function), // onStreamError
				);
			});

			// Wait for the regenerated response to appear
			expect(
				await rendered.findByText('Regenerated response: Two plus two equals four.'),
			).toBeInTheDocument();
		});

		it('edits message and regenerates response when user edits their message', async () => {
			const user = userEvent.setup();

			// Set up route with existing session ID
			mockRoute.params = { id: 'existing-session-123' };

			// Mock existing conversation with user and AI message
			vi.mocked(chatApi.fetchSingleConversationApi).mockResolvedValue(
				createMockConversationResponse({
					session: createMockSession({
						id: 'existing-session-123',
						provider: 'custom-agent',
						agentId: 'agent-123',
						agentName: 'Test Custom Agent',
					}),
					conversation: {
						messages: {
							'msg-1': createMockMessageDto({
								id: 'msg-1',
								sessionId: 'existing-session-123',
								content: 'Original question',
							}),
							'msg-2': createMockMessageDto({
								id: 'msg-2',
								sessionId: 'existing-session-123',
								type: 'ai',
								name: 'Assistant',
								content: 'Original answer',
								provider: 'custom-agent',
								agentId: 'agent-123',
								previousMessageId: 'msg-1',
							}),
						},
					},
				}),
			);

			// Mock editMessage API
			vi.mocked(chatApi.editMessageApi).mockImplementation(
				(_ctx, _sessionId, _editId, _payload, onMessageUpdated, onDone) => {
					void Promise.resolve().then(async () => {
						onMessageUpdated(
							createMockStreamChunk({
								type: 'begin',
								content: '',
								metadata: {
									messageId: 'ai-message-edit-123',
									previousMessageId: 'msg-1',
								},
							}),
						);

						onMessageUpdated(
							createMockStreamChunk({
								type: 'item',
								content: 'Updated answer based on edited question',
								metadata: {
									messageId: 'ai-message-edit-123',
									previousMessageId: 'msg-1',
								},
							}),
						);

						onMessageUpdated(
							createMockStreamChunk({
								type: 'end',
								content: '',
								metadata: {
									messageId: 'ai-message-edit-123',
									previousMessageId: 'msg-1',
								},
							}),
						);

						onDone();
					});
				},
			);

			const rendered = renderComponent({ pinia });

			// Wait for existing messages to be displayed
			expect(await rendered.findByRole('log')).toBeInTheDocument();

			// Wait for messages to appear
			expect(await rendered.findByText('Original answer')).toBeInTheDocument();

			// Find all messages and get the first one (user message)
			const messages = rendered.queryAllByTestId('chat-message');
			const userMessage = messages[0];

			// Click the edit button within the user message
			const editButton = await within(userMessage).findByRole('button', { name: 'Edit' });
			await user.click(editButton);

			// Find the textarea within the user message that's now in edit mode
			const textarea = (await within(userMessage).findByRole('textbox')) as HTMLTextAreaElement;

			// Clear and type edited message
			await user.clear(textarea);
			await user.type(textarea, 'Edited question');

			// Click the Send button within the user message
			const sendButton = await within(userMessage).findByRole('button', { name: 'Send' });
			await user.click(sendButton);

			// Verify editMessageApi was called with correct parameters
			await waitFor(() => {
				expect(chatApi.editMessageApi).toHaveBeenCalledWith(
					expect.anything(), // restApiContext
					'existing-session-123', // sessionId
					'msg-1', // editId (the original user message ID being edited)
					expect.objectContaining({
						messageId: expect.any(String), // promptId (new UUID for the revision)
						message: 'Edited question',
						model: { provider: 'custom-agent', agentId: 'agent-123' },
						credentials: {},
					}),
					expect.any(Function), // onStreamMessage
					expect.any(Function), // onStreamDone
					expect.any(Function), // onStreamError
				);
			});

			// Wait for the edited response to appear
			expect(
				await rendered.findByText('Updated answer based on edited question'),
			).toBeInTheDocument();
		});

		it('switches to alternative response when user selects alternative', async () => {
			const user = userEvent.setup();

			// Set up route with existing session ID
			mockRoute.params = { id: 'existing-session-123' };

			// Mock existing conversation with message that has alternatives (retry)
			vi.mocked(chatApi.fetchSingleConversationApi).mockResolvedValue(
				createMockConversationResponse({
					session: createMockSession({
						id: 'existing-session-123',
						provider: 'custom-agent',
						agentId: 'agent-123',
						agentName: 'Test Custom Agent',
					}),
					conversation: {
						messages: {
							'msg-1': createMockMessageDto({
								id: 'msg-1',
								sessionId: 'existing-session-123',
								content: 'What is AI?',
							}),
							'msg-2': createMockMessageDto({
								id: 'msg-2',
								sessionId: 'existing-session-123',
								type: 'ai',
								name: 'Assistant',
								content: 'First response about AI',
								provider: 'custom-agent',
								agentId: 'agent-123',
								previousMessageId: 'msg-1',
							}),
							// Alternative response (retry)
							'msg-2-retry': createMockMessageDto({
								id: 'msg-2-retry',
								sessionId: 'existing-session-123',
								type: 'ai',
								name: 'Assistant',
								content: 'Second response about AI (regenerated)',
								provider: 'custom-agent',
								agentId: 'agent-123',
								previousMessageId: 'msg-1',
								retryOfMessageId: 'msg-2',
							}),
						},
					},
				}),
			);

			const rendered = renderComponent({ pinia });

			// Wait for messages to be displayed
			expect(await rendered.findByRole('log')).toBeInTheDocument();

			// Initially, the latest alternative (msg-2-retry) should be shown
			expect(
				await rendered.findByText('Second response about AI (regenerated)'),
			).toBeInTheDocument();

			// The alternative counter should show "2/2" (second of two alternatives)
			expect(await rendered.findByText('2/2')).toBeInTheDocument();

			// Find the previous alternative button by its accessible label
			const prevButton = await rendered.findByRole('button', { name: 'Previous alternative' });
			await user.click(prevButton);

			// Now the first response should be displayed
			expect(await rendered.findByText('First response about AI')).toBeInTheDocument();

			// The counter should now show "1/2"
			expect(await rendered.findByText('1/2')).toBeInTheDocument();

			// The second response should not be in the document anymore
			expect(
				rendered.queryByText('Second response about AI (regenerated)'),
			).not.toBeInTheDocument();
		});
	});
});
