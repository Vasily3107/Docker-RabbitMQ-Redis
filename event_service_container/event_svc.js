const amqp = require('amqplib');
const url = require('./url.js');
const rmq_names = require('./rabbitmq_names.js');
const db = require('./db.js');

async function main() {
    const connection = await amqp.connect(url.rabbitmq);
    const channel = await connection.createChannel();

    const queue = rmq_names.event_queue;
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
            case 'get_all_events':
                res.status = 200;
                res.data = await db.Event.find();
                break;


            case 'get_event':
                if (!req_body_check()) break;
                if (!req.body.id) {
                    res.status = 400;
                    res.message = 'Missing event id'
                    break;
                }
                res.status = 200;
                res.data = await db.Event.findById(req.body.id);
                break;


            case 'create_event':
                if (!req_body_check()) break;
                locals.tmp = req.body.max_num_of_members;
                if (!req.body.title || !req.body.date || locals.tmp == undefined) {
                    res.status = 400;
                    res.message = 'Missing arguments: title, date, max_num_of_members'
                    break;
                }
                if (isNaN(Number(locals.tmp)) || Number(locals.tmp) <= 0 || !Number.isInteger(locals.tmp)) {
                    res.status = 400;
                    res.message = 'Argument "max_num_of_members" must be a positive integer'
                    break;
                }

                await db.Event.create({ title: req.body.title, date: req.body.date, max_num_of_members: req.body.max_num_of_members });
                res.status = 200;
                res.message = 'Event created'
                break;


            case 'update_event':
                if (!req_body_check()) break;
                if (!req.body.id) {
                    res.status = 400;
                    res.message = 'Missing event id'
                    break;
                }
                locals.tmp = req.body.max_num_of_members;
                if (locals.tmp !== undefined && isNaN(Number(locals.tmp)) || Number(locals.tmp) <= 0 || !Number.isInteger(locals.tmp)) {
                    res.status = 400;
                    res.message = 'Argument "max_num_of_members" must be a positive integer'
                    break;
                }
                if (!(await db.Event.findById(req.body.id))) {
                    res.status = 400;
                    res.message = 'Event does not exist'
                    break;
                }

                locals.update = {}
                if (req.body.title) locals.update.title = req.body.title;
                if (req.body.date) locals.update.date = req.body.date;
                if (req.body.max_num_of_members) locals.update.max_num_of_members = req.body.max_num_of_members;
                await db.Event.findByIdAndUpdate(req.body.id, locals.update);
                res.status = 200;
                res.message = 'Event updated'
                break;


            case 'delete_event':
                if (!req_body_check()) break;
                if (!req.body.id) {
                    res.status = 400;
                    res.message = 'Missing event id'
                    break;
                }
                res.status = 200;
                res.message = 'Event deleted'
                await db.Event.findByIdAndDelete(req.body.id);
                break;


            default:
                res.status = 400;
                res.message = `EVENT SERVICE: Unknown route: ${req.route}`;
        }

        channel.sendToQueue(msg.properties.replyTo,
            Buffer.from(JSON.stringify(res)), {
            correlationId: msg.properties.correlationId
        });

        channel.ack(msg);
    }).then(() => {
        console.log('Event service started');
    });
}

main();