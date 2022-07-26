/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from 'cockpit';
import React from 'react';
import { Alert, Card, CardTitle, CardBody, Checkbox, DataList, DataListItem, DataListItemRow, DataListItemCells, DataListCell, Button, Spinner } from '@patternfly/react-core';
import { FanIcon, ThermometerHalfIcon, ChargingStationIcon, CpuIcon } from '@patternfly/react-icons/dist/esm/icons/';
const _ = cockpit.gettext;
export class Application extends React.Component {
    constructor() {
        super();
        this.state = { sensors: {}, intervalId: {}, alert: null, fahrenheitTemp: [], fahrenheitChecked: false, isShowBtnInstall: false, sensorArgumet: "-j", isShowLoading: false };

        cockpit.file('/etc/hostname').watch(content => {
            this.setState({ hostname: content.trim() });
        });
    }

    componentDidMount() {
        const intervalId = setInterval(() => {
            this.loadSensors();
        }, 1000);
        this.setState({ intervalId });
    }

    componentWillUnmount() {
        clearInterval(this.state.intervalId);
    }

    loadSensors = () => {
        cockpit
                .spawn(["sensors", this.state.sensorArgumet].concat(this.state.fahrenheitTemp), { err: "message", superuser: "try" })
                .done((sucess) => {
                    if (this.state.sensorArgumet === "-j") {
                        this.setState({ sensors: JSON.parse(sucess), isShowBtnInstall: false });
                    } else {
                        const sensorsJson = {};
                        sucess.split(/\n\s*\n/).forEach(raw => {
                            let sensorsGroupName = "";
                            let index = 0;
                            let sensorTitle = "";
                            raw.split(/\n\s*/).forEach(element => {
                                if (index === 0) {
                                    sensorsGroupName = element;
                                    sensorsJson[sensorsGroupName] = {};
                                }
                                if (index === 1) {
                                    const adapter = element.split(":");
                                    sensorsJson[sensorsGroupName][adapter[0]] = adapter[1].trim();
                                }
                                if (index >= 2) {
                                    const sensor = element.trim().split(":");
                                    if (sensor[1] === "") {
                                        sensorTitle = element.split(":")[0];
                                        sensorsJson[sensorsGroupName][sensorTitle] = {};
                                    } else {
                                        sensorsJson[sensorsGroupName][sensorTitle][sensor[0]] = parseFloat(sensor[1].trim());
                                    }
                                }

                                index += 1;
                            });
                        });
                        this.setState({ sensors: sensorsJson, isShowBtnInstall:  false });
                    }
                })
                .fail((err) => {
                    if (err.message === "not-found") {
                        this.setState({ isShowBtnInstall: true });
                        this.setAlert(_('lm-sensors not found, you want install it ?'), 'danger');
                        return;
                    }
                    if (err.message === "sensors: invalid option -- 'j'") {
                        this.setState({ sensorArgumet: "-u" });
                        return;
                    }

                    if (err.message === "sensors: invalid option -- 'u'") {
                        this.setAlert(_("this version of lm-sensors don't suport output sensors data!"), 'danger');
                        return;
                    }
                    this.setAlert(err.message, 'warning');
                    clearInterval(this.state.intervalId);
                });
    };

    setIcon = (name) => {
        if (name.includes('fan')) {
            return <FanIcon size='md' />;
        }
        if (name.includes('temp')) {
            return <ThermometerHalfIcon size='md' />;
        }
        if (name.includes('in')) {
            return <ChargingStationIcon size='md' />;
        }
        if (name.includes('cpu')) {
            return <CpuIcon size='md' />;
        }
        return <></>;
    };

    adjustLabel = (label) => {
        return label.replace(label.substring(0, label.indexOf('_')) + '_', '');
    };

    setAlert = (msg, variant) => {
        this.setState({ alert: { msg, variant } });
    };

    handleChange = (checked, event) => {
        this.setState({ fahrenheitChecked: checked });
        if (checked) {
            this.setAlert(_('lm-sensors has a bug that converts all data to fahrenheit, including voltage, fans and etc.'), 'info');
            this.setState({ fahrenheitTemp: ['-f'] });
        } else {
            this.setState({ fahrenheitTemp: [], alert: null });
        }
    };

    handleInstallSensors = () => {
        this.setState({ isShowLoading : true });
        cockpit.spawn(["apt-get", "install", "lm-sensors", "-y"], { err: "message", superuser: "require" })
                .done((sucess) => {
                    cockpit.spawn(["sensors-detect", "--auto"], { err: "message", superuser: "require" })
                            .done((sucess) => {
                                this.setState({ isShowLoading : false });
                                cockpit.spawn(["modprobe", "coretemp"], { err: "message", superuser: "require" });
                                cockpit.spawn(["modprobe", "i2c-i801"], { err: "message", superuser: "require" });
                                cockpit.spawn(["modprobe", "drivetemp"], { err: "message", superuser: "require" });
                            })
                            .fail((err) => {
                                this.setAlert(err.message, 'warning');
                            });
                })
                .fail((err) => {
                    this.setAlert(err.message, 'warning');
                });
    };

    render() {
        const { sensors, alert, fahrenheitChecked, isShowBtnInstall, isShowLoading } = this.state;
        return (
            <>
                <Card>
                    <CardTitle>{_('Sensors')}</CardTitle>
                    <CardBody>
                        <Checkbox
                            label={_("Show temperature in Fahrenheit")}
                            isChecked={fahrenheitChecked}
                            onChange={this.handleChange}
                            id="fahrenheit-checkbox"
                            name="fahrenheit-checkbox"
                        />
                        <>
                            {isShowLoading ? <Spinner isSVG /> : <></>}
                            {alert != null ? <Alert variant={alert.variant}>{alert.msg}</Alert> : <></>}
                            {isShowBtnInstall ? <Button onClick={this.handleInstallSensors}>{_('Install')}</Button> : <></>}
                        </>
                        {sensors !== null
                            ? Object.entries(sensors).map((key, index) =>
                                <Card key={key}>
                                    <CardTitle>{key[0]}</CardTitle>
                                    <CardBody>
                                        <CardTitle>{key[1].Adapter}</CardTitle>
                                        <DataList isCompact>
                                            <DataListItem>
                                                {
                                                    Object.entries(key[1]).map((item, index) => {
                                                        if (index === 0) return item;
                                                        return (
                                                            <React.Fragment key={item}>
                                                                <span>{item[0]}:</span>
                                                                <DataListItemRow key={item}>
                                                                    <DataListItemCells
                                                                    dataListCells={
                                                                        Object.entries(item[1]).map((sensors, index) => (
                                                                            <DataListCell key={sensors}>{index === 0 ? this.setIcon(sensors[0]) : ''} {this.adjustLabel(sensors[0])}: {sensors[1]}</DataListCell>
                                                                        ))
                                                                    }
                                                                    />
                                                                </DataListItemRow>
                                                            </React.Fragment>
                                                        );
                                                    })
                                                }
                                            </DataListItem>
                                        </DataList>
                                    </CardBody>
                                </Card>
                            )
                            : ''}
                    </CardBody>
                </Card>
            </>
        );
    }
}
