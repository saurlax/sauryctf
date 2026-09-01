import { handleCreateChallengeTemplate } from '../../../infrastructure/challenges/challenge-template-http'

export default defineEventHandler(event => handleCreateChallengeTemplate(event))
