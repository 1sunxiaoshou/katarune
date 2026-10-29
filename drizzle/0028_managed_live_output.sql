UPDATE `live_settings` SET `config` = json_remove(`config`, '$.fps', '$.videoBitrateKbps');
