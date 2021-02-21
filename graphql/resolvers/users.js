const { Message, User } = require('../../models')
const bcrypt = require('bcryptjs')
const { UserInputError, AuthenticationError } = require('apollo-server')
const jwt = require('jsonwebtoken')
const { JWT_SECRET } = require('../../config/env.json')
const { Op } = require('sequelize')

module.exports = {
    Query: {
        getUsers: async (_, __, { user }) => {
            try {
                if(!user) throw new AuthenticationError('Unauthenticated')

                let users = await User.findAll({
                    attributes: ['username', 'imageUrl', 'createdAt'],
                    where: { username: { [Op.ne]: user.username }}  /// All except me
                })

                const allUserMessages = await Message.findAll({
                    where: {
                        [Op.or]: [{ from: user.username }, {to: user.username}]
                    },
                    order: [['createdAt', 'DESC']]
                })

                users = users.map(otherUser => {
                    const latestMessage = allUserMessages.find(
                        m => m.from === otherUser.username || m.to === otherUser.username
                    )
                    otherUser.latestMessage = latestMessage
                    return otherUser
                })

                return users
            } catch (err) {
                console.log(err)
                throw err
            }
        },
        login: async (_, args) => {
            const { username, password } = args
            let errors = {}

            try {
                // validate input data
                if (username.trim() === '') errors.username = "Username must not be empty"
                if (password.trim() === '') errors.password = "Password must not be empty"

                if (Object.keys(errors).length > 0) {
                    throw new UserInputError('Bad input', {errors})
                }

                // TODO check username and password exist
                const user = await User.findOne({ where: { username }})
                if (!user) {
                    errors.username = "Username does not exist"
                    throw new UserInputError('user not found', { errors })
                }
                const correctPassword = await bcrypt.compare(password, user.password)
                if (!correctPassword) {
                    errors.password = "Password is incorrect"
                    throw new UserInputError('password is incorrect', { errors })
                }

                const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h'})

                return {
                    ...user.toJSON(),
                    createdAt: user.createdAt.toISOString(),
                    token
                }

            } catch (e) {
                console.log(e)
                throw e
                // throw new UserInputError('Bad input', {errors})
            }
        }
    },
    Mutation: {
        register: async (_, args) => {
            let { username, email, password, confirmPassword } = args
            let errors = {}

            try {
                // validate input data
                if (email.trim() === '') errors.email = "Email must not be empty"
                if (username.trim() === '') errors.username = "Username must not be empty"
                if (password.trim() === '') errors.password = "Password must not be empty"
                if (confirmPassword.trim() === '') errors.confirmPassword = "ConfirmPassword must not be empty"
                if (password !== confirmPassword) errors.confirmPassword = "Password must match"

                if (Object.keys(errors).length > 0) {
                    throw errors
                }

                password = await bcrypt.hash(password, 6)

                // Create user
                const user = await User.create({
                    username,
                    email,
                    password
                })
                return user
            } catch (err) {
                console.log(err)
                if (err.name === 'SequelizeUniqueConstraintError' ) {
                    err.errors.forEach(er => (errors[er.path] = `${er.path} is already taken`))
                } else if(err.name === 'SequelizeValidationError') {
                    err.errors.forEach(er => (errors[er.path] = er.message))
                }
                throw new UserInputError('Bad input', {errors})
            }
        },
    }
}
