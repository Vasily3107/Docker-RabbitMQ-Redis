const amqp = require('amqplib');
const url = require('./url.js');
const rmq_names = require('./rabbitmq_names.js');
const db = require('./db.js');

async function main() {
    const connection = await amqp.connect(url.rabbitmq);
    const channel = await connection.createChannel();

    const queue = rmq_names.user_queue;
    await channel.assertQueue(queue, { durable: true, arguments: { 'x-queue-type': 'quorum' } });

    channel.consume(queue, async function reply(msg) {
        const req = JSON.parse(msg.content.toString());
        const res = {};

        const req_body_check = () => {
            if (req.body) return true;
            res.status = 400;
            res.message = 'req.body not found';
            return false;
        }

        const locals = {};

        switch (req.route) {
            case 'sign_up':
                if (!req_body_check()) break;
                if (!req.body.name || !req.body.password) {
                    res.status = 400;
                    res.message = 'Missing name or password'
                    break;
                }
                if (await db.User.findOne({ name: req.body.name })) {
                    res.status = 400;
                    res.message = 'Name is already taken'
                    break;
                }
                await db.User.create({ name: req.body.name, password: req.body.password, role: req.body.role ?? 'user' });
                res.status = 200;
                res.message = `User created with role: ${req.body.role ?? 'user'}`
                break;


            case 'get_all_users':
                res.status = 200;
                res.data = await db.User.find();
                break;


            case 'get_user':
                if (!req_body_check()) break;
                if (!req.body.id) {
                    res.status = 400;
                    res.message = 'Missing user id'
                    break;
                }
                res.status = 200;
                res.data = await db.User.findById(req.body.id);
                break;


            case 'is_admin':
                if (!req_body_check()) break;
                if (!req.body.name || !req.body.password) {
                    res.status = 400;
                    res.message = 'ADMIN CHECK: Missing name or password'
                    break;
                }
                locals.user = await db.User.findOne({ name: req.body.name, password: req.body.password });
                if (!locals.user) {
                    res.status = 400;
                    res.message = 'User does not exist'
                    break;
                }
                res.status = 200;
                res.data = { is_admin: locals.user.role == 'admin' }
                break;


            default:
                res.status = 400;
                res.message = `USER SERVICE: Unknown route: ${req.route}`;
        }

        channel.sendToQueue(msg.properties.replyTo,
            Buffer.from(JSON.stringify(res)), {
            correlationId: msg.properties.correlationId
        });

        channel.ack(msg);
    }).then(() => {
        console.log('User service started');
    });
}

main();