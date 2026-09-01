export interface SubmissionAnswerContext {
  contestId: string
  challengeId: string
  participationId: string
  teamId: string
  userId: string
  requestId: string
}

export interface ProtectedSubmissionAnswer {
  digest: Buffer
  ciphertext: Buffer
}

export interface SubmissionAnswerProtector {
  protect(answer: string, context: SubmissionAnswerContext): ProtectedSubmissionAnswer
}
