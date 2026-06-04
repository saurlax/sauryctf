import type { components } from '~/types/api'

type GameParticipation = components['schemas']['GameParticipation']

export type PublicGamePhase = 'draft' | 'before_start' | 'active' | 'ended'

type PublicParticipationStateInput = {
  gameId: number
  gamePhase: PublicGamePhase
  practiceMode?: boolean
  isLoggedIn: boolean
  participation: GameParticipation | null | undefined
  registrationMode?: 'review' | 'auto_accept'
  maxTeamMembers?: number
}

type PublicParticipationMeta = {
  label: string
  color: 'info' | 'error' | 'warning' | 'success' | 'neutral'
  description: string
  actionLabel: string
  actionTo: string
}

type PublicParticipationHints = {
  title: string
  description: string
  color: 'info' | 'error' | 'warning' | 'success' | 'neutral'
  submitHint: string
  visibilityHint: string
}

function getPhaseEndedDescription() {
  return '当前无法再报名，但仍可进入查看题目与排行榜。'
}

export function usePublicGameParticipationState() {
  function resolveParticipationMeta(input: PublicParticipationStateInput): PublicParticipationMeta {
    const { gameId, gamePhase, practiceMode = false, isLoggedIn, participation, registrationMode = 'review' } = input

    if (!isLoggedIn) {
      return {
        label: '登录后可查看报名状态',
        color: 'neutral',
        description: '先登录，再决定创建队伍或直接进入比赛详情页。',
        actionLabel: '去登录',
        actionTo: '/login',
      }
    }

    if (!participation?.has_team) {
      return {
        label: '未加入队伍',
        color: 'warning',
        description: '需要先创建或加入队伍，才能报名比赛并提交 Flag。',
        actionLabel: '去队伍页',
        actionTo: '/console/team',
      }
    }

    if (participation.participated) {
      if (participation.missing_writeup) {
        return {
          label: '待补 Writeup',
          color: 'warning',
          description: `当前队伍 ${participation.team?.name || ''} 已通过比赛报名，但在截止时间前还没有提交 Writeup。`,
          actionLabel: '去补交',
          actionTo: `/games/${gameId}`,
        }
      }

      if (participation.status === 'pending') {
        return {
          label: '待审核',
          color: 'warning',
          description: `当前队伍 ${participation.team?.name || ''} 已提交报名，等待管理员审核。`,
          actionLabel: '查看详情',
          actionTo: `/games/${gameId}`,
        }
      }

      if (participation.status === 'rejected') {
        return {
          label: '已拒绝',
          color: 'error',
          description: `当前队伍 ${participation.team?.name || ''} 的报名未通过，可进入详情页重新确认。`,
          actionLabel: '重新报名',
          actionTo: `/games/${gameId}`,
        }
      }

      if (participation.writeup_required && participation.writeup_submitted && participation.writeup_status === 'submitted') {
        return {
          label: 'Writeup 待审',
          color: 'info',
          description: `当前队伍 ${participation.team?.name || ''} 已提交 Writeup，等待管理员审核。`,
          actionLabel: '查看详情',
          actionTo: `/games/${gameId}`,
        }
      }

      return {
        label: '已报名',
        color: 'success',
        description: `当前队伍 ${participation.team?.name || ''} 已进入该比赛。`,
        actionLabel: gamePhase === 'active' || (gamePhase === 'ended' && practiceMode) ? '进入比赛' : '查看详情',
        actionTo: `/games/${gameId}`,
      }
    }

    if (gamePhase === 'ended') {
      return {
        label: '比赛已结束',
        color: 'error',
        description: getPhaseEndedDescription(),
        actionLabel: '查看详情',
        actionTo: `/games/${gameId}`,
      }
    }

    return {
      label: '可报名',
      color: 'info',
      description: registrationMode === 'auto_accept'
        ? `当前队伍 ${participation.team?.name || ''} 尚未报名，进入详情页后可直接完成参赛确认。`
        : `当前队伍 ${participation.team?.name || ''} 尚未报名，可进入详情页完成操作。`,
      actionLabel: '前往报名',
      actionTo: `/games/${gameId}`,
    }
  }

  function resolveParticipationHints(input: PublicParticipationStateInput): PublicParticipationHints {
    const { gamePhase, practiceMode = false, isLoggedIn, participation, registrationMode = 'review', maxTeamMembers } = input

    if (!isLoggedIn) {
      return {
        title: '当前为公开浏览模式',
        description: '未登录时仍可浏览公开比赛的基础信息、题目标题和排行榜。登录后才会显示你的队伍状态，并继续报名比赛。',
        color: 'info',
        submitHint: '请先登录后再参与比赛。',
        visibilityHint: '当前公开页已向访客开放题目标题、分类、分值和解题统计。登录、组队并通过报名后，才会继续开放完整题面、提示和附件。',
      }
    }

    if (!participation?.has_team) {
      return {
        title: '需要先加入队伍',
        description: '当前比赛以内队形式参赛。请先创建或加入队伍，再返回此页面报名。',
        color: 'warning',
        submitHint: '当前需要先加入队伍，才能报名比赛并提交 Flag。',
        visibilityHint: '当前比赛以内队形式参赛。先加入队伍并完成报名后，才会逐步开放完整题面内容。',
      }
    }

    if (!participation.participated) {
      if (gamePhase === 'ended') {
        return {
          title: '比赛已结束，无法再报名',
          description: '你仍然可以查看比赛信息、题目和排行榜，但不能再加入本场比赛。',
          color: 'error',
          submitHint: '比赛已结束，当前不能继续提交 Flag。',
          visibilityHint: '当前队伍还没有报名这场比赛。你现在可以先看题目标题、分类和分值，完整题面会在通过报名后开放。',
        }
      }

      if (gamePhase === 'draft') {
        return {
          title: '比赛尚未开放',
          description: '当前比赛还在准备阶段。管理员切换为可用状态后，队伍才可以开始报名。',
          color: 'neutral',
          submitHint: '当前队伍尚未报名本场比赛，请先在上方完成报名。',
          visibilityHint: '当前队伍还没有报名这场比赛。你现在可以先看题目标题、分类和分值，完整题面会在通过报名后开放。',
        }
      }

      return {
        title: '当前可报名',
        description: registrationMode === 'auto_accept'
          ? `当前队伍尚未报名，这场比赛会自动通过报名，确认后即可直接进入参赛状态${maxTeamMembers ? `。注意队伍人数不能超过 ${maxTeamMembers} 人` : ''}。`
          : `当前队伍尚未报名，进入本场比赛前请确认队伍成员已准备完成${maxTeamMembers ? `，且队伍人数不超过 ${maxTeamMembers} 人` : ''}。`,
        color: 'info',
        submitHint: '当前队伍尚未报名本场比赛，请先在上方完成报名。',
        visibilityHint: '当前队伍还没有报名这场比赛。你现在可以先看题目标题、分类和分值，完整题面会在通过报名后开放。',
      }
    }

    if (participation.missing_writeup) {
      return {
        title: '需要补交 Writeup',
        description: participation.writeup_deadline
          ? `当前队伍已通过比赛报名，但在 ${new Date(participation.writeup_deadline).toLocaleString()} 前还没有提交 Writeup，请尽快前往 Writeup 标签补交。`
          : '当前队伍已通过比赛报名，但这场比赛要求提交 Writeup，请尽快前往 Writeup 标签补交。',
        color: 'warning',
        submitHint: '当前比赛要求 Writeup，且截止时间已过，但你的队伍还没有提交。',
        visibilityHint: gamePhase === 'before_start'
          ? '当前队伍已通过报名，但比赛尚未开始。为了避免提前泄题，完整题面会在开赛后自动开放。'
          : '当前已开放完整题面，你可以查看提示、附件并按比赛规则提交 Flag。',
      }
    }

    if (participation.status === 'pending') {
      return {
        title: '报名待审核',
        description: '当前队伍已经提交报名，等待管理员审核通过后才能正式参赛与提交 Flag。',
        color: 'warning',
        submitHint: '当前报名还在等待管理员审核，审核通过后才可以提交 Flag。',
        visibilityHint: '当前报名正在审核中。审核通过前，题目详情、提示和附件会继续隐藏。',
      }
    }

    if (participation.status === 'rejected') {
      return {
        title: '报名已被拒绝',
        description: '当前队伍的报名未通过。你可以根据比赛公告调整后重新提交报名申请。',
        color: 'error',
        submitHint: '当前报名已被拒绝，请重新报名或联系管理员确认参赛资格。',
        visibilityHint: '当前报名未通过。重新调整队伍并再次报名后，审核通过才会开放完整题面。',
      }
    }

    if (participation.writeup_required && participation.writeup_submitted && participation.writeup_status === 'submitted') {
      return {
        title: 'Writeup 待审核',
        description: '当前队伍已经提交 Writeup，等待管理员审核。比赛侧的报名资格不受影响，但你可以继续回到 Writeup 标签更新内容。',
        color: 'info',
        submitHint: gamePhase === 'before_start'
          ? '比赛尚未开始，当前暂时不能提交 Flag。'
          : gamePhase === 'ended'
              ? (practiceMode ? '正式比赛已结束，但当前比赛开启了赛后练习模式，你可以继续补题提交。' : '比赛已结束，当前不能继续提交 Flag。')
              : '当前队伍已具备提交资格。',
        visibilityHint: gamePhase === 'before_start'
          ? '当前队伍已通过报名，但比赛尚未开始。为了避免提前泄题，完整题面会在开赛后自动开放。'
          : '当前已开放完整题面，你可以查看提示、附件并按比赛规则提交 Flag。',
      }
    }

    return {
      title: '当前已报名',
      description: participation.status === 'accepted'
        ? '当前队伍报名已通过。根据当前赛事规则，已通过的报名不会再开放撤回。'
        : gamePhase === 'active'
            ? '比赛进行中，当前队伍可以直接前往题目区提交 Flag。'
            : '比赛结束后也无法继续提交 Flag。',
      color: 'success',
      submitHint: gamePhase === 'before_start'
        ? '比赛尚未开始，当前暂时不能提交 Flag。'
        : gamePhase === 'ended'
            ? (practiceMode ? '正式比赛已结束，但当前比赛开启了赛后练习模式，你可以继续补题提交。' : '比赛已结束，当前不能继续提交 Flag。')
            : '当前队伍已具备提交资格。',
      visibilityHint: gamePhase === 'before_start'
        ? '当前队伍已通过报名，但比赛尚未开始。为了避免提前泄题，完整题面会在开赛后自动开放。'
        : '当前已开放完整题面，你可以查看提示、附件并按比赛规则提交 Flag。',
    }
  }

  return {
    resolveParticipationMeta,
    resolveParticipationHints,
  }
}
