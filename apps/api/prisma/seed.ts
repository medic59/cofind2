import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "argon2";

const adapter = new PrismaPg(
  process.env.DATABASE_URL || "postgresql://postgres:cofind_secure_pass2026@localhost:5432/cofind?schema=public"
);
const prisma = new PrismaClient({ adapter });

const demoPassword = "password123";

async function resetDatabase() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.moderationAction.deleteMany(),
    prisma.report.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.like.deleteMany(),
    prisma.messageQuote.deleteMany(),
    prisma.messageReaction.deleteMany(),
    prisma.canvasDrawing.deleteMany(),
    prisma.globalChatMessage.deleteMany(),
    prisma.message.deleteMany(),
    prisma.conversationParticipant.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.listingResponse.deleteMany(),
    prisma.charactersOnListings.deleteMany(),
    prisma.fandomsOnListings.deleteMany(),
    prisma.genresOnListings.deleteMany(),
    prisma.tagsOnListings.deleteMany(),
    prisma.listingMeta.deleteMany(),
    prisma.listing.deleteMany(),
    prisma.moderationSuggestion.deleteMany(),
    prisma.character.deleteMany(),
    prisma.fandom.deleteMany(),
    prisma.genre.deleteMany(),
    prisma.tag.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.userSubscription.deleteMany(),
    prisma.subscriptionPlan.deleteMany(),
    prisma.adPlacement.deleteMany(),
    prisma.seoPage.deleteMany(),
    prisma.systemSetting.deleteMany(),
    prisma.ban.deleteMany(),
    prisma.userBlock.deleteMany(),
    prisma.userPreferences.deleteMany(),
    prisma.profile.deleteMany(),
    prisma.user.deleteMany()
  ]);
}

async function main() {
  await resetDatabase();
  const passwordHash = await hash(demoPassword);

  const [owner, moderator, mira, arlen, lysa] = await Promise.all([
    prisma.user.create({
      data: {
        email: "owner@cofind.local",
        passwordHash,
        role: "OWNER",
        status: "ACTIVE",
        profile: {
          create: {
            username: "owner",
            displayName: "Cofind Owner",
            bio: "Владелец платформы Cofind 2.",
            writingStyle: "systems thinking"
          }
        },
        preferences: { create: { theme: "minimal", accentColor: "#596275" } }
      }
    }),
    prisma.user.create({
      data: {
        email: "mod@cofind.local",
        passwordHash,
        role: "MODERATOR",
        status: "ACTIVE",
        profile: {
          create: {
            username: "modera",
            displayName: "Modera",
            bio: "Модерирует чат, жалобы и предложения справочников.",
            writingStyle: "clear and kind"
          }
        },
        preferences: { create: { theme: "forest", accentColor: "#2f7d63" } }
      }
    }),
    prisma.user.create({
      data: {
        email: "mira@cofind.local",
        passwordHash,
        role: "PREMIUM_USER",
        isPremium: true,
        profile: {
          create: {
            username: "miraink",
            displayName: "MiraInk",
            bio: "Пишу камерные сюжеты, люблю атмосферу, сложные диалоги и бережный темп.",
            favoriteGenres: ["детектив", "фэнтези"],
            favoriteFandoms: ["ориджиналы"],
            favoriteCharacters: ["OC"],
            writingStyle: "атмосферный",
            activityLevel: "2-3 ответа в неделю",
            preferredPostLength: "3-6 абзацев"
          }
        },
        preferences: {
          create: {
            theme: "Lavender Studio",
            accentColor: "#7a5cff",
            secondaryColor: "#2f7d63",
            dashboardBackgroundType: "preset",
            cardStyle: "soft",
            borderRadius: 8,
            showAdultContent: true
          }
        }
      }
    }),
    prisma.user.create({
      data: {
        email: "arlen@cofind.local",
        passwordHash,
        role: "USER",
        profile: {
          create: {
            username: "arlen",
            displayName: "Arlen",
            bio: "Ищу партнеров для urban fantasy, диалогов и медленного раскрытия персонажей.",
            favoriteGenres: ["urban fantasy", "драма"],
            writingStyle: "диалоговый",
            activityLevel: "ежедневно короткими сценами"
          }
        },
        preferences: { create: { theme: "Dark Writer", accentColor: "#9d8cff" } }
      }
    }),
    prisma.user.create({
      data: {
        email: "lysa@cofind.local",
        passwordHash,
        role: "USER",
        profile: {
          create: {
            username: "lysa",
            displayName: "Lysa",
            bio: "Бета-ридинг, логика сцен, грамотность и мягкая редактура.",
            favoriteGenres: ["космоопера", "приключения"],
            writingStyle: "структурный"
          }
        },
        preferences: { create: { theme: "Paper Novel", accentColor: "#2f7d63" } }
      }
    })
  ]);

  const [slowBurn, detective, academy, oc, dialogue, betaTag] = await Promise.all([
    prisma.tag.create({ data: { slug: "slow-burn", name: "slow burn", aliases: ["медленное развитие"] } }),
    prisma.tag.create({ data: { slug: "detective", name: "детектив" } }),
    prisma.tag.create({ data: { slug: "magic-academy", name: "магическая академия" } }),
    prisma.tag.create({ data: { slug: "oc", name: "OC", aliases: ["original character"] } }),
    prisma.tag.create({ data: { slug: "dialogue", name: "dialogue", aliases: ["диалоги"] } }),
    prisma.tag.create({ data: { slug: "beta-reading", name: "бета-ридинг" } })
  ]);

  const [fantasy, drama, adventure] = await Promise.all([
    prisma.genre.create({ data: { slug: "fantasy", name: "Фэнтези" } }),
    prisma.genre.create({ data: { slug: "drama", name: "Драма" } }),
    prisma.genre.create({ data: { slug: "adventure", name: "Приключения" } })
  ]);

  const [originals, starRail] = await Promise.all([
    prisma.fandom.create({
      data: {
        slug: "originals",
        name: "Ориджиналы",
        description: "Авторские миры и персонажи без привязки к конкретному канону."
      }
    }),
    prisma.fandom.create({
      data: {
        slug: "honkai-star-rail",
        name: "Honkai: Star Rail",
        aliases: ["Star Rail", "HSR"]
      }
    })
  ]);

  const [ocCharacter, trailblazer] = await Promise.all([
    prisma.character.create({ data: { slug: "original-character", name: "Original Character", fandomId: originals.id, status: "APPROVED" } }),
    prisma.character.create({ data: { slug: "trailblazer", name: "Trailblazer", fandomId: starRail.id, status: "APPROVED" } })
  ]);

  const premiumPlan = await prisma.subscriptionPlan.create({
    data: {
      code: "premium-monthly",
      name: "Творческая студия",
      description: "Отключение рекламы, расширенные фоны профиля и дополнительные темы внешнего вида.",
      priceCents: 19900,
      durationDays: 30,
      features: {
        adFree: true,
        premiumBadge: true,
        profileBackgrounds: true,
        advancedAppearance: true
      }
    }
  });

  await prisma.userSubscription.create({
    data: {
      userId: mira.id,
      planId: premiumPlan.id,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 27)
    }
  });

  const academyListing = await prisma.listing.create({
    data: {
      authorId: mira.id,
      type: "COAUTHOR_SEARCH",
      title: "Камерный детектив в магической академии",
      slug: "kamerny-detektiv-v-magicheskoy-akademii",
      body: "Ориджинал с интригой, закрытым кругом подозреваемых и персонажной драмой без гонки по темпу.",
      ageRating: "MATURE",
      fandomMode: "ORIGINAL",
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      publishedAt: new Date(),
      meta: {
        create: {
          preferredPairing: "gen или slow burn",
          desiredRole: "соавтор для второго POV",
          canonOrOc: "OC",
          writingStyle: "атмосферный, с вниманием к деталям",
          postLengthExpectation: "3-6 абзацев",
          activityExpectation: "2-3 ответа в неделю",
          grammarExpectation: "уверенная грамотность",
          hardLimits: "давление по темпу, обесценивание границ",
          plotNotes: "Магическая академия, тайные общества, пропавший преподаватель и личные секреты героев.",
          communicationFormat: "личные сообщения Cofind",
          sampleText: "В коридоре пахло мокрой бумагой и озоном: кто-то снова пытался стереть следы заклинанием."
        }
      },
      tags: { create: [{ tagId: slowBurn.id }, { tagId: detective.id }, { tagId: academy.id }, { tagId: oc.id }] },
      genres: { create: [{ genreId: fantasy.id }, { genreId: drama.id }] },
      fandoms: { create: [{ fandomId: originals.id }] },
      characters: { create: [{ characterId: ocCharacter.id }] }
    }
  });

  const roleplayListing = await prisma.listing.create({
    data: {
      authorId: arlen.id,
      type: "ROLEPLAY_SEARCH",
      title: "Urban fantasy, переписки персонажей и found family",
      slug: "urban-fantasy-perepiski-personazhey",
      body: "Люблю короткие сцены, атмосферные диалоги, цитирование и постепенное раскрытие отношений.",
      ageRating: "TEEN",
      fandomMode: "MIXED",
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      publishedAt: new Date(),
      meta: {
        create: {
          desiredRole: "соигрок",
          writingStyle: "диалоговый",
          postLengthExpectation: "2-4 абзаца",
          activityExpectation: "ежедневно или через день",
          communicationFormat: "чат + личные сообщения"
        }
      },
      tags: { create: [{ tagId: slowBurn.id }, { tagId: dialogue.id }, { tagId: oc.id }] },
      genres: { create: [{ genreId: fantasy.id }, { genreId: drama.id }] },
      fandoms: { create: [{ fandomId: originals.id }] },
      characters: { create: [{ characterId: ocCharacter.id }] }
    }
  });

  const betaListing = await prisma.listing.create({
    data: {
      authorId: lysa.id,
      type: "BETA_READER_SEARCH",
      title: "Бета-ридер для фанфика по космоопере",
      slug: "beta-rider-dlya-kosmoopery",
      body: "Проверка логики сцен, ритма и грамотности. Текст 45 тысяч знаков, дедлайн мягкий.",
      ageRating: "EVERYONE",
      fandomMode: "FANDOM",
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      publishedAt: new Date(),
      meta: {
        create: {
          grammarExpectation: "высокая",
          expectedDuration: "2 недели",
          collaborationRules: "Правки в формате комментариев, без переписывания авторского голоса."
        }
      },
      tags: { create: [{ tagId: betaTag.id }, { tagId: dialogue.id }] },
      genres: { create: [{ genreId: adventure.id }] },
      fandoms: { create: [{ fandomId: starRail.id }] },
      characters: { create: [{ characterId: trailblazer.id }] }
    }
  });

  await Promise.all([
    prisma.listingResponse.create({
      data: {
        listingId: academyListing.id,
        senderId: arlen.id,
        message: "Готов обсудить второй POV и темп. Нравится идея с тайными обществами.",
        status: "ACCEPTED"
      }
    }),
    prisma.listingResponse.create({
      data: {
        listingId: academyListing.id,
        senderId: lysa.id,
        message: "Могу помочь как бета-ридер с логикой расследования.",
        status: "NEW"
      }
    }),
    prisma.like.create({ data: { userId: arlen.id, entityType: "LISTING", entityId: academyListing.id } }),
    prisma.like.create({ data: { userId: mira.id, entityType: "LISTING", entityId: roleplayListing.id } }),
    prisma.like.create({ data: { userId: owner.id, entityType: "LISTING", entityId: betaListing.id } })
  ]);

  const conversation = await prisma.conversation.create({
    data: {
      participants: {
        create: [{ userId: mira.id }, { userId: arlen.id }]
      },
      messages: {
        create: [
          { senderId: mira.id, text: "Спасибо за отклик. Хочешь начать с обсуждения арки второго POV?" },
          { senderId: arlen.id, text: "Да, и я бы сразу отметил границы по темпу, чтобы всем было спокойно." }
        ]
      }
    }
  });

  const globalMessage = await prisma.globalChatMessage.create({
    data: {
      senderId: mira.id,
      text: "Кто-нибудь писал заявки так, чтобы сразу отсечь неподходящий темп ответов?"
    }
  });

  const globalReply = await prisma.globalChatMessage.create({
    data: {
      senderId: moderator.id,
      text: "Помогает отдельный блок: длина поста, частота, формат обсуждений и hard limits."
    }
  });

  await prisma.globalChatMessage.create({
    data: {
      senderId: arlen.id,
      room: "fandoms",
      text: "В фандомной комнате удобно заранее писать, какой канон и какие AU допустимы."
    }
  });

  await Promise.all([
    prisma.messageQuote.create({
      data: {
        globalMessageId: globalReply.id,
        quotedGlobalMessageId: globalMessage.id,
        quotedTextSnapshot: globalMessage.text
      }
    }),
    prisma.messageReaction.create({
      data: {
        globalMessageId: globalMessage.id,
        userId: arlen.id,
        emoji: "✨"
      }
    }),
    prisma.messageReaction.create({
      data: {
        globalMessageId: globalReply.id,
        userId: mira.id,
        emoji: "👍"
      }
    }),
    prisma.canvasDrawing.create({
      data: {
        userId: arlen.id,
        globalMessageId: globalReply.id,
        imageUrl: "https://cdn.example.local/drawings/demo-canvas.png",
        width: 400,
        height: 300
      }
    })
  ]);

  await Promise.all([
    prisma.report.create({
      data: {
        reporterId: lysa.id,
        listingId: roleplayListing.id,
        entityType: "LISTING",
        entityId: roleplayListing.id,
        reason: "OTHER",
        comment: "Демо-жалоба для проверки очереди модерации.",
        status: "NEW"
      }
    }),
    prisma.moderationSuggestion.create({
      data: {
        authorId: arlen.id,
        type: "TAG",
        title: "cozy mystery",
        description: "Мягкий детектив без тяжелой жестокости, с фокусом на атмосферу.",
        sourceUrl: "https://example.local/cozy-mystery",
        status: "NEW"
      }
    }),
    prisma.ban.create({
      data: {
        userId: lysa.id,
        issuedById: moderator.id,
        type: "MUTE",
        reason: "Демо-мут для проверки модели временных ограничений.",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60)
      }
    }),
    prisma.notification.create({
      data: {
        userId: mira.id,
        type: "RESPONSE_CREATED",
        title: "Новый отклик",
        description: "Lysa откликнулась на вашу заявку.",
        linkPath: `/listing/${academyListing.slug}`
      }
    })
  ]);

  await Promise.all([
    prisma.adPlacement.create({
      data: {
        name: "Feed sidebar demo",
        position: "SIDEBAR",
        status: "ACTIVE",
        clickUrl: "https://example.local",
        imageUrl: "https://cdn.example.local/ads/feed-sidebar.png",
        target: { roles: ["USER"], hideForPremium: true }
      }
    }),
    prisma.seoPage.create({
      data: {
        path: "/feed",
        title: "Заявки на поиск соавторов и соигроков - Cofind 2",
        description: "Лента творческих заявок Cofind 2: соавторы, ролевые партнеры, бета-ридеры и команды.",
        h1: "Лента заявок",
        canonical: "https://cofind.example/feed",
        breadcrumbs: [{ title: "Главная", path: "/" }, { title: "Заявки", path: "/feed" }]
      }
    }),
    prisma.seoPage.create({
      data: {
        path: "/chat",
        title: "Общий чат Cofind 2",
        description: "Публичный чат авторов и ролевиков с цитатами, реакциями и мини-холстом.",
        h1: "Общий чат",
        canonical: "https://cofind.example/chat"
      }
    }),
    prisma.systemSetting.create({
      data: {
        key: "site.rulesVersion",
        value: { version: "2026.05", adultContentRequiresMarking: true, rateLimitEnabled: true }
      }
    }),
    prisma.systemSetting.create({
      data: {
        key: "features.monetizationEnabled",
        value: false
      }
    }),
    prisma.auditLog.create({
      data: {
        actorId: owner.id,
        action: "SEED_DATABASE",
        entityType: "SYSTEM",
        metadata: { conversationId: conversation.id }
      }
    })
  ]);

  // Demo users are established fixtures — mark them email-verified so they can
  // publish and message (new real registrations still require verification).
  await prisma.user.updateMany({ where: { emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });

  console.log("Seeded Cofind 2 demo data.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
