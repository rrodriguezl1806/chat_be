const { Message, User, Reaction } = require('../../models')
const { UserInputError, AuthenticationError, withFilter, ForbiddenError } = require('apollo-server')
const { Op } = require('sequelize')

module.exports = {
    Query: {
        getMessages: async (parent, { from }, { user }) => {
            try {
                if(!user) throw new AuthenticationError('Unauthenticated')

                const anotherUser = await User.findOne({ where: { username: from }})
                const usernames = [user.username, anotherUser.username]
                const message = await Message.findAll({
                    where: {
                        from: { [Op.in]: usernames },
                        to: { [Op.in]: usernames },
                    },
                    order: [['createdAt', 'DESC']],
                    include: [{ model: Reaction, as: 'reactions'}]
                })

                return message

            } catch (e) {
                throw e
            }
        }
    },
    Mutation: {
        sendMessage: async (parent, { to, content }, { user, pubSub }) => {
            try {
                if(!user) throw new AuthenticationError('Unauthenticated')

                const recipient = await User.findOne({ where: { username: to }})

                if (!recipient) throw new UserInputError('User not found')
                if (content.trim() === '') throw new UserInputError('Message is empty')

                const message = await Message.create({
                    from: user.username,
                    to,
                    content
                })

                pubSub.publish('NEW_MESSAGE', { newMessage: message })

                return message
            } catch (e) {
                console.log(e)
                throw e
            }
        },
        reactToMessage: async (_, { uuid, content }, { user, pubSub }) => {
            const reactions = ['❤️', '😆', '😯', '😢', '😡', '👍', '👎']
            try {

                if (!reactions.includes(content)) {
                    throw new UserInputError('Invalid reaction')
                }

                // GET USER
                const username = user ? user.username : ''
                user = await User.findOne({ where: { username }})
                if(!user) throw new AuthenticationError('Unauthenticated')

                // GET MESSAGE
                const message = await Message.findOne({ where: { uuid }})
                if (!message) throw new UserInputError('Message not found')


                if (message.from !== user.username && message.to !== user.username) {
                    throw new ForbiddenError('')
                }

                let reaction = await Reaction.findOne({
                    where: { messageId: message.id, userId: user.id }
                })

                if (reaction) {
                    reaction.content = content
                    await reaction.save()
                } else {
                    reaction = await Reaction.create({
                        messageId: message.id,
                        userId: user.id,
                        content
                    })
                }

                pubSub.publish('NEW_REACTION', { newReaction: reaction })

                return reaction
            } catch (e) {
                throw e
            }
        }
    },
    Subscription: {
        newMessage: {
            subscribe: withFilter(
                (_, __, { pubSub, user }) => {
                    if(!user) throw new AuthenticationError('Unauthenticated')

                    return pubSub.asyncIterator(["NEW_MESSAGE"])
                }, ({ newMessage }, _, { user }) => {
                    if (newMessage.from === user.username || newMessage.to === user.username) {
                        return true
                    }
                    return false
                }
            )
        },
        newReaction: {
            subscribe: withFilter(
                (_, __, { pubSub, user }) => {
                    if(!user) throw new AuthenticationError('Unauthenticated')

                    return pubSub.asyncIterator("NEW_REACTION")
                }, async ({ newReaction }, _, { user }) => {
                    const message = await newReaction.getMessage()
                    if (message.from === user.username || message.to === user.username) {
                        return true
                    }
                    return false
                }
            )
        }
    }
}
